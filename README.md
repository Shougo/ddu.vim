# ddu.vim

> Dark deno-powered UI framework for Vim/Neovim

If you don't want to configure plugins, you don't have to use the plugin. It
does not work with zero configuration. You can use other plugins.

[![Doc](https://img.shields.io/badge/doc-%3Ah%20ddu-orange.svg)](doc/ddu.txt)

Please read [help](doc/ddu.txt) for details.

**NOTE:** I have created a
[Japanese article](https://zenn.dev/shougo/articles/ddu-vim-beta) for ddu.vim.

Ddu is the abbreviation of "dark deno-powered UI". It provides an extensible and
asynchronous UI framework for Vim/Neovim.

The development is supported by
[GitHub Sponsors](https://github.com/sponsors/Shougo/). Thank you!

<!-- vim-markdown-toc GFM -->

- [Introduction](#introduction)
- [Screenshots](#screenshots)
- [Install](#install)
- [Quick Start](#quick-start)

<!-- vim-markdown-toc -->

## Introduction

I have chosen the denops.vim framework to create this plugin because denops.vim
is better than the Neovim Python interface.

- Easy to set up
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

**NOTE:** For the current version requirements, see the `COMPATIBILITY` section
in `doc/ddu.txt` (`:h ddu-compatibility`).

## Quick Start

Below is a minimal configuration to get started with ddu.vim. For detailed
documentation, see [doc/ddu.txt](doc/ddu.txt).

You will need a UI, at least one source, and a kind plugin. The example below
uses the popular combination of
[ddu-ui-ff](https://github.com/Shougo/ddu-ui-ff),
[ddu-source-file](https://github.com/Shougo/ddu-source-file),
[ddu-kind-file](https://github.com/Shougo/ddu-kind-file), and
[ddu-filter-matcher_substring](https://github.com/Shougo/ddu-filter-matcher_substring).

### Quick Start

A minimal runtime configuration example (no plugin-manager-specific
instructions):

```vim
" Example: minimal settings to configure and start ddu.
" Ensure ddu.vim and at least one UI and one source are installed beforehand.

" Set a default UI and basic kind option.
call ddu#custom#patch_global(#{
    \   ui: 'ff',
    \ })

" Set the default action for file kind
call ddu#custom#patch_global(#{
    \   kindOptions: #{
    \     file: #{
    \       defaultAction: 'open',
    \     },
    \   },
    \ })

" Use substring matcher
call ddu#custom#patch_global(#{
    \   sourceOptions: #{
    \     _: #{
    \       matchers: ['matcher_substring'],
    \     },
    \   },
    \ })

" Open ddu with the file source in the current directory
call ddu#start(#{
    \   sources: [#{ name: 'file', params: {} }],
    \ })

" Start ddu with a simple source list and optional input.
" Replace 'file' with any installed source name.
:call ddu#start({'name': 'list', 'sources': ['file']})
```

Notes:

- For full documentation, read `:help ddu` or open `doc/ddu.txt`.
- If you are unsure which UI or source to install first, see the community
  topic: https://github.com/topics/ddu-vim
