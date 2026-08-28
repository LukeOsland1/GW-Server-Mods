# Design

## Why Galactic War needs this

Community Mods excludes Galactic War from its own `startGame` wrapper with a single
early-return in `ui/main/game/community_mods/states/connect_to_game.js`:

```js
if (window.gNoMods || mode.substr(-2, 2).toLowerCase() == "gw") {
  model.gameModIdentifiers([]);
  model.companionModsChecked(true);
  model.needsServerModsUpload(false);
  return oldStartGame(region, mode, startParams);
}
```

The branch it skips — `activeServerModIdentifiersToMount()` → `checkCompanionMods()` →
`mountServerMods()` → call through — is complete and generic. Galactic War simply never
reaches it, so no server mod is mounted, the referee cannot read the mod's unit specs, and
the server starts with `commanders:[null]`.

## Chrome 40

Shipped code runs in Coherent UI's Chrome 40. No `let`, arrow functions, template literals
or `class`; a parse error takes out the whole script rather than the line. `eslint.config.mjs`
is the executable statement of that limit and its whitelist is exhaustive — no entry means
no. `ko`, `_` (lodash 3.9.3), `$` and `api` are globals, and every scene shares one JS scope,
which is why each module is an IIFE that guards against being loaded twice.

## Seams assigned after mod scripts run

Three separate functions this mod wraps do not exist, or are replaced, at the moment a
scene mod loads:

| Seam                                   | When it is assigned                                                         |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `api.file.unmountAllMemoryFiles`       | Replaced by Community Mods' `gw_referee` state script after the scene loads |
| `handlers.request_client_mod_manifest` | Assigned by `connect_to_game` during its own setup                          |
| `model.send_message`                   | Created in `app.registerWithCoherent`, which runs _after_ `loadSceneMods`   |

Each is taken with an `Object.defineProperty` accessor that re-wraps whatever is
assigned, rather than reading the value once. A repeating timer was tried for the first
of them and is the wrong tool: it is a race, and it stops defending after a fixed number
of tries. **Anything a scene sets up during its own boot should be taken this way.**

## Mounting

Two mounts per server mod, both needed:

| Mount                                | Who does it                              | Why                                                                                                                                   |
| ------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `/server_mods/<id>/` and `mods.json` | `CommunityModsManager.mountServerMods()` | What the server reads, including the `mount_order` manifest                                                                           |
| `/`                                  | `shared/mount.js`                        | Galactic War's referee generates unit specs client side from `spec://pa/units/…`, and `/server_mods/<id>/` is not on that lookup path |

No mod is named in the code and no unit specs are bundled. The set comes from
`CommunityModsManager.activeServerModsToMount()`, minus the manager's own generated
`community-mods-server` aggregate, which is derived from the others and so is not something a
player can be missing.

### Folder-installed server mods do not work

A server mod installed as a folder rather than a zip cannot be reached by the client.
`zip.mount` returns `false` for a directory and there is no directory equivalent, so its
content never arrives at the VFS root: the referee cannot read its unit specs and the
renderer has no models. Nothing here can fix that, so it raises `filesystem_server_mod`
and tells the player to install the mod as a zip instead.

An earlier version of this file claimed such mods needed no mount because the game already
exposed `server_mods` folders at the root. That was wrong, and instructively so: the
evidence was `coui://pa/ai_queller/...` resolving for a folder-installed Queller, but the
base game ships `pa_ex1/ai_queller/`, so the probe was reading stock content at the same
path. A mod adding a path the base game does not have - `pa/units/l_*` - returns 404.

The alarm is raised only for folder mods the client has to render, so an AI-only one like
Queller stays quiet: its content is genuinely server-side and its absence from the root
costs nothing.

Folder-installed **client** mods are unaffected - `client_mods/` folders do reach the root,
confirmed against a companion supplying textures from one.

## Keeping the mounts

Community Mods' `remountClientMods()` calls `unmountAllMemoryFiles`, which drops the root
mounts partway through battle setup. Wrapping that function once is not enough: the Community
Mods `gw_referee` state script reassigns it after the scene loads. `shared/hooks.js` installs
an accessor so whatever is assigned gets re-wrapped, which is deterministic where a repeating
timer is a race that also gives up after a fixed number of tries.

### A faction's art is split across two mods

Legion ships its **models** in the server mod and its **textures** in the paired client
mod:

| File                              | Server mod    | Client mod      |
| --------------------------------- | ------------- | --------------- |
| `l_raptor.papa` (model)           | 183,183 bytes | absent          |
| `l_raptor_diffuse.papa` (texture) | absent        | 1,365,902 bytes |

Mounting only the server zip therefore produces a correctly shaped commander rendered
entirely in white. `pairedClientMods()` reads each active server mod's declared
`companions` array and mounts the active client mods it names — Legion's server
`modinfo.json` declares `"companions": ["com.pa.legion-expansion-client"]`. The
dependency is stated by the mod author rather than inferred from a name. A declared
companion that is not active is logged as `companion client mods not all active` rather
than alarmed — the right severity, since the failure is a white unit and not a broken
battle. The residual risk is a server mod that ships split art but declares no
`companions`: it gets no pairing at all, silently.

### The content catalogue

Mounting makes files readable; it does not register models and textures with the
renderer. `api.content.remount()` rebuilds that catalogue, and Community Mods does the
same after mounting client zips. Without it every spec resolves and every unit is
invisible.

It must **not** run during a battle: it blanks the scene, and the models are already
loaded by then, so `live_game` holds the mounts with `remountContent: false`. Zip mounts
themselves survive a remount - that was checked directly, before and after.

## Strategic icons

The icon atlas is built once, at startup. `icon_atlas.js` holds a hardcoded list of 132
names, mods extend it through the `icon_atlas` scene, and `sendIconList()` hands the
result to the engine. Nothing rebuilds it: a name pushed later is accepted and ignored,
which is why a modded unit shows the fallback dot and why re-sending the list during a
battle changes nothing.

Legion does ship `ui/mods/com.pa.legion-expansion/icon_atlas.js` naming its own icons.
That file is delivered through the **server mods' UI list**, which only loads when server
mods are mounted at UI-load time - so skirmish gets it and Galactic War never does.

`icon_atlas/icons.js` sidesteps that by naming every icon on disk rather than only the
ones the base game knows. It needs no mounting: a mod shipping strategic icons shadows
them into `ui/main/atlas/icon_atlas/img/strategic_icons/`, and client mods are mounted
before this scene runs. Listing is async and the scene sends its list as soon as the file
returns, so `sendIconList` is wrapped rather than raced - the scene's own call triggers
the enumeration and the list goes out once, complete.

Two known limits. This duplicates Legion's own mechanism rather than restoring it; the
better fix is to make Galactic War load `ui_mod_list_for_server.js`. And the atlas grows
from 132 to 274 names with one faction loaded; PA's atlas texture limit is unknown, and an
overflow would show up as _other_ icons breaking rather than the modded ones.

## The co-op guard

Galactic War co-op already validates client mods host-first, and the server side of that check
(`server-script/states/gw_lobby.js`, `gw_campaign.js`) is set and version matching on opaque
identifier strings — it does not care whether an identifier names a client mod or a server
mod. `set_required_client_mods` is host-only. So server mods join the existing check rather
than getting a new one, and a mismatch lands on the mod-mismatch screen the game already has.

Both payloads are augmented at `model.send_message`, not by reimplementing the functions that
build them.

### Which server mods have to match

Not all of them. A server mod only has to be on the viewer's client if the client renders
its content, and the marker is what it ships under `pa/`:

| Mod                     | `pa/` trees                           | Required |
| ----------------------- | ------------------------------------- | -------- |
| Legion Expansion        | ammo, ai, anim, effects, units, tools | yes      |
| Alien Worlds            | terrain (89 `.papa` CSG models)       | yes      |
| Simple Biomes, tetctree | terrain                               | yes      |
| Queller AI              | `ai_queller`                          | no       |

The test excludes the server-only trees - anything matching `ai` or `ai_*` - rather than
listing the rendered ones. An unrecognised tree is then treated as client-relevant, which
is too strict rather than too lax: a guard that wrongly blocks a join is visible, one that
wrongly allows it produces a battle that fails later.

A units-only rule was considered and rejected. `pa/units/unit_list.json` is a reliable
marker for a unit mod, because registry files have no append mechanism, but Alien Worlds
ships 89 CSG models with no units at all and would have been excluded.

Classification needs the mods mounted, so it runs as part of the mount, and the answer is
persisted in `sessionStorage`. That is not an optimisation: the mount that classifies runs
in one scene and the gate that reads it runs in another, and each scene is a separate page
with its own copy of this module. Held in memory alone, the gate never sees a
classification and silently falls back to requiring everything.

Until a classification exists the gate does require every active server mod, rather than
none.

|                                 | Host publishes | Viewer reports                           |
| ------------------------------- | -------------- | ---------------------------------------- |
| Server mod the host runs        | yes            | yes, if the viewer has it                |
| Server mod only the viewer runs | n/a            | no — unless it declares `galacticWarMod` |

| Case                                                     | Result                                |
| -------------------------------------------------------- | ------------------------------------- |
| Host has it, viewer does not                             | Blocked, named on the mismatch screen |
| Both have it, versions differ                            | Blocked as a version mismatch         |
| Viewer has it, host does not                             | Joins; recorded as not shared         |
| Viewer has it with `galacticWarMod: true`, host does not | Blocked — stock behaviour, unchanged  |

That last row is deliberate. `galacticWarMod` means "everyone must match on this" for client
mods today, and this mod must not quietly soften it for server mods.

`GwServerMods.hostHasServerMod(identifier)` answers what the host published, so a feature can
offer only what the host supports — a viewer running Legion against a host that is not should
not be offered Legion.

## Identifier case

The gate normalises identifiers to lower case on both sides, so that comparison is safe.
`model.gameModIdentifiers` goes back to the game instead - reconnect info and the beacon -
where a mod installed as `qQuellerAI-dev` must not become `qquellerai-dev`. `manifest.js`
carries both forms for that reason.

## Alarms

Failures here otherwise surface much later as a missing unit or a battle that will not
start, so they are raised on screen as well as in the console, in wording a player can
act on. The banner is a bonus rather than the report: not every scene composites its root
document, `live_game` in particular.

### Logging

PA's log file keeps only the **first** console argument, so every call builds one
concatenated string. Passing `message, detail` lands in the log as `message` alone.

`api.debug.log` is not used and should not be. It is a forwarder -
`Function.apply.call(console.log, console, arguments)` - so it truncates identically, and
it adds two problems: every call is gated on a `debug_allow_logs` local setting that is
unset by default, so output vanishes for exactly the user who needs it; and the log
records its call site (`boot.js`) rather than ours, losing which module spoke.

Stock agrees with itself here: Community Mods and the `[GW COOP]` code both concatenate
rather than pass multiple arguments.

`cmm_unavailable` and `gate_unavailable` matter most - a partly installed guard is worse
than none, because it looks like enforcement.

## What this cannot fix

Only a locally hosted Galactic War works, which is what co-op uses. A remote or dedicated
Galactic War server cannot receive mod files at all: `mod_data_available` exists only in
`server-script/states/lobby.js`, and the upload is gated on a redirect to `new_game.html` that
Galactic War never performs. Adding it needs a server mod.

Nothing verifies that mounted server-mod content matches what a saved war was created against,
so a war resumed after a mod update can lose units with no warning.

## Verification

There are no tests; verification is loading the game.

1. Solo local war, launch a battle — server mod units present, no `commanders:[null]`.
2. No `identifiers_lost` alarm, and `model.gameModIdentifiers()` holds the server mod at
   connect time. **This is the one assumption taken from reading the base game rather than
   from observing it**, which is why it alarms rather than failing quietly.
3. Mounts survive `gw_play` → `live_game`.
4. Co-op with a viewer missing the host's server mod — mismatch screen names it.
5. Co-op with a viewer running an extra server mod — joins, and `hostHasServerMod` is false.
   Then set `"galacticWarMod": true` on that mod and repeat: the viewer must be blocked.
6. Host and viewer on different versions of the same mod — version mismatch.
7. A second, unrelated server mod, to confirm nothing is specific to one mod.
