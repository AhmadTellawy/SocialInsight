# Local security patch

This directory vendors `braces` 3.0.3 under its MIT license and reports the
local version as `3.0.4-socialinsight.1`.

The adjacent `braces-3.0.4-socialinsight.1.tgz` is generated from this source
with `npm pack`. Both project lockfiles record its integrity, and consume the
tarball rather than a directory link so npm installs `fill-range` correctly
when the frontend or server is installed on its own.

The only behavioral change is a parser-enforced maximum AST nesting depth of
100. It applies to both brace and parenthesis nodes before the recursive
compile, expand, or stringify walkers run. This prevents the stack exhaustion
described by GHSA-vfj7-8cjw-p6xm / CVE-2026-93687 while retaining the upstream
10,000-character input limit.

Remove this fork when an upstream release containing an equivalent depth guard
is available and has passed the repository's dependency and build checks.
