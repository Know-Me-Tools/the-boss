# artifact-011-navigation-and-miniapp

## Purpose

Make the artifact library/editor a first-class product surface outside settings,
including left navigation and mini-app access.

## Scope

- Add an artifact library route/page using existing routing patterns.
- Add a sidebar icon/configuration entry without introducing new store shape.
- Register an artifact mini-app/library entry using existing minapp infrastructure.
- Reuse the library/designer implementation from `artifact-009`.
- Add labels and focused UI tests where practical.

## Success Criteria

- The artifact library is reachable from left navigation.
- The artifact library/editor is reachable as a mini-app/library surface.
- Existing settings artifact management remains available.
- Sidebar/minapp migrations preserve existing user settings.
