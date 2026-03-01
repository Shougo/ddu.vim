# ddu.vim

> Dark deno-powered UI framework for Vim/Neovim

If you don't want to configure plugins, you don't have to use the plugin. It
does not work with zero configuration. You can use other plugins.

[![Doc](https://img.shields.io/badge/doc-%3Ah%20ddu-orange.svg)](doc/ddu.txt)

Please read [help](doc/ddu.txt) for details.

NOTE: I have created
[Japanese article](https://zenn.dev/shougo/articles/ddu-vim-beta) for ddu.vim.

Ddu is the abbreviation of "dark deno-powered UI". It provides an extensible and
asynchronous UI framework for Vim/Neovim.

The development is supported by
[github sponsors](https://github.com/sponsors/Shougo/). Thank you!

<!-- vim-markdown-toc GFM -->

- [Introduction](#introduction)
- [Screenshots](#screenshots)
- [Install](#install)

<!-- vim-markdown-toc -->

## Introduction

I have chosen denops.vim framework to create new plugin. Because denops.vim is
better than Neovim Python interface.

- Easy to setup
- Minimal dependency
- Stability
- Vim/Neovim compatibility
- Speed
- Library
- Easy to hack

## Screenshots

Please see: https://github.com/Shougo/ddu.vim/issues/10

![ddu-ui-ff](https://user-images.githubusercontent.com/41495/154783539-469f773a-ab05-437e-9827-9cc6d1444f80.png)

## Install

**NOTE:** For the exact compatibility and requirements, see the COMPATIBILITY section in the documentation: `doc/ddu.txt`.

### Requirements

Please install both Deno 2.3.0+ and denops.vim v8.0+ (see `doc/ddu.txt` for the latest requirements).

- https://deno.land/
- https://github.com/vim-denops/denops.vim

**NOTE:** ddu.vim does not include any UI, source, filter, column or kind
plugins. Install the extensions you need separately (search for the `ddu-vim`
topic on GitHub).

### Quick Start

A minimal runtime configuration example (no plugin-manager-specific instructions):

```vim
" Example: minimal settings to configure and start ddu.
" Ensure ddu.vim and at least one UI and one source are installed beforehand.

" Set a default UI and basic kind option.
call ddu#custom#patch_global(#{
    \   ui: 'ff',
    \ })

call ddu#custom#patch_global(#{
    \   kindOptions: #{
    \     file: #{
    \       defaultAction: 'open',
    \     },
    \   }
    \ })

" Start ddu with a simple source list and optional input.
" Replace 'file' with any installed source name.
:call ddu#start({'name': 'list', 'sources': ['file']})
```

Notes:
- For full documentation, read `:help ddu` or open `doc/ddu.txt`.
- If you are unsure which UI or source to install first, see the community topic: https://github.com/topics/ddu-vim
