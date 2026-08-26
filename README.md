# GW Server Mods

Galactic War does not mount server mods. Community Mods excludes it deliberately, so a
battle launched from a war runs without Legion Expansion or any other server mod, and
Galactic War's referee then fails to generate unit specs for units it cannot see.

This mod mounts whatever server mods you have active before a Galactic War battle starts,
and in co-op it makes the host the source of truth about which ones are in play.

## What it does

- Mounts every active server mod for Galactic War battles, generically. No mod is named in
  the code and no unit specs are bundled, so nothing goes stale when a server mod updates.
- Keeps those mounts alive across Galactic War's remount cycle, which otherwise drops them
  part way through battle setup.
- In co-op, publishes the host's active server mods to the game's own required-mod check. A
  viewer missing one is stopped at the existing mod-mismatch screen and told which mod and
  why, rather than landing in a battle that fails.
- A viewer running a server mod the host is not gets to play regardless — they are simply
  recorded as not sharing it, so features can offer only what the host actually supports.

## What it does not do

Only a locally hosted Galactic War is supported, which is what co-op uses. A Galactic War on
a remote or dedicated server cannot receive mod files at all: the base game's upload path is
tied to the custom-game lobby that Galactic War never visits, and the Galactic War server
state has no handler to receive it. That needs a server mod, not this one.

## How it works

See [docs/design.md](docs/design.md).

## Requirements

- Planetary Annihilation: TITANS
- Community Mods

## Credits

**kikta** wrote the original proof of concept this mod grew out of
(`com.pa.gw-server-mods-enable`). It established that a hand-mounted server mod survives
into a Galactic War battle at all, and identified the failure chain that makes it hard:
Community Mods' `remountClientMods` calls `unmountAllMemoryFiles`, the Galactic War referee
then cannot read the mod's unit specs, and the server starts with no commanders.

## Licence

[CC BY 4.0](LICENSE)
