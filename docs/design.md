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

An unpacked (`fileSystem`) server mod has no zip to root-mount. It reaches
`/server_mods/<id>/` but not the referee, and raises `filesystem_mod`.

## Keeping the mounts

Community Mods' `remountClientMods()` calls `unmountAllMemoryFiles`, which drops the root
mounts partway through battle setup. Wrapping that function once is not enough: the Community
Mods `gw_referee` state script reassigns it after the scene loads. `shared/hooks.js` installs
an accessor so whatever is assigned gets re-wrapped, which is deterministic where a repeating
timer is a race that also gives up after a fixed number of tries.

## The co-op guard

Galactic War co-op already validates client mods host-first, and the server side of that check
(`server-script/states/gw_lobby.js`, `gw_campaign.js`) is set and version matching on opaque
identifier strings — it does not care whether an identifier names a client mod or a server
mod. `set_required_client_mods` is host-only. So server mods join the existing check rather
than getting a new one, and a mismatch lands on the mod-mismatch screen the game already has.

Both payloads are augmented at `model.send_message`, not by reimplementing the functions that
build them.

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
