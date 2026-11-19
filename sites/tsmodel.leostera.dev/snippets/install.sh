bun add -d @tsmodel/tsmodel    # the DSL, its types, and the CLI (needs Bun 1.3+)
bunx tsmodel check             # type-check, run the scenarios, explore, judge every rule
bunx tsmodel dev               # the simulator, reloading as the spec changes
bunx tsmodel build             # everything in one self-contained .tsmodel/index.html
