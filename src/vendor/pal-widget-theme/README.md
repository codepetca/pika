# Vendored Pal widget theme contract

This directory copies the dependency-free public theme contract from the Pal
repository at commit `7a6d869216ace2a8098aff2ebf590cf3c42b67ce`.

Pika vendors only the property and attribute manifest while `@pal/widget`
remains a private, unpublished package. It does not vendor Pal components,
styles, artwork, or behavior.

Do not change this contract locally. Change it in Pal first, replace
`theme-contract.ts` with the reviewed upstream version, update the commit above,
and update the Pika adapter in the same change. Once Pika consumes a published
package, tests should import `@pal/widget/theme-contract` directly and this
vendored copy should be deleted.
