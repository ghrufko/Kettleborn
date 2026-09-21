# hunts

Not used as a separate content type. Each monster's hunt list is embedded
directly in its `content/monsters/<id>.json` file (a `hunts` array), since
a hunt has no independent existence outside its owning monster. This folder
is kept as a reserved extension point in case a future content type
(e.g. cross-monster event hunts) genuinely needs standalone hunt files.
