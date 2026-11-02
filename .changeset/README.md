# Changesets

Na feature větvi spusť `npm run changeset`, vyber změněné balíčky a commitni
vygenerovaný Markdown. Po sloučení do `main` workflow otevře nebo aktualizuje PR
s verzemi a changelogy. Jeho sloučením se verze zapíší do `main`.

Všechny workspaces jsou zatím privátní. Verze i changelogy se aktualizují,
balíčky se nepublikují do npm. Infrastructure se neverzuje.

Lokálně lze aplikovat changesety příkazem `npm run version-packages`.
