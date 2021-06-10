run:
	deno run --allow-read --allow-net denoops/ddu/app.ts

# For Development
.PHONY: dev
dev: deno vim

.PHONY: d
d:
	watchexec -c '$(MAKE) dev'

## deno {{{
.PHONY: deno
deno: deno-format deno-lint deno-test

.PHONY: deno-lint
deno-lint:
	deno fmt --check
	deno lint

.PHONY: format
deno-format:
	deno fmt

.PHONY: deno-test
deno-test:
	deno test
# }}}

## Vim {{{
.PHONY: vim
vim: vim-lint

.PHONY: vim-lint
vim-lint: tools/py/bin/vint
	./tools/py/bin/vint --version
# }}}

## Prepare tools {{{
prepare: tools/py/bin/vint tools/vim-themis

tools/vim-themis: tools
	git clone https://github.com/thinca/vim-themis $@

tools/py/bin/vint: tools/py/bin
	cd tools && ./py/bin/pip install vim-vint

tools/py/bin: tools
	cd tools && python -m venv py

tools:
	mkdir -p $@
# }}}

# vim: foldmethod=marker
