#!/bin/sh
# Kör alla tester. Varje fil får en egen server på en ledig port och en egen
# databas i minnet, så de går parallellt utan att störa varandra.
cd "$(dirname "$0")/.." && exec node --disable-warning=ExperimentalWarning --test "$@" tester/*.test.mjs
