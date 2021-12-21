# ddu.vim

Note: It is vaporware!!  You cannot use it yet.

> Dark deno-powered UI framework for neovim/Vim8

If you don't want to configure plugins, you don't have to use the plugin.
It does not work with zero configuration.  You can use other plugins.

[![Doc](https://img.shields.io/badge/doc-%3Ah%20ddu-orange.svg)](doc/ddu.txt)

Please read [help](doc/ddu.txt) for details.

Ddu is the abbreviation of "dark deno-powered UI". It provides an
extensible and asynchronous UI framework for neovim/Vim8.


The development is supported by [github sponsors](https://github.com/sponsors/Shougo/). Thank you!


<!-- vim-markdown-toc GFM -->

- [Introduction](#introduction)
- [Install](#install)
  - [Requirements](#requirements)
- [Configuration](#configuration)
- [Screenshots](#screenshots)

<!-- vim-markdown-toc -->


## Introduction

I have chosen denops.vim framework to create new plugin.
Because denops.vim is better than neovim Python interface.

* Easy to setup
* Minimal dependency
* Stability
* neovim/Vim8 compatibility
* Speed
* Library
* Easy to hack


## Install

**Note:** Ddu.vim requires Neovim (0.5.0+ and of course, **latest** is
recommended) or Vim 8.2.0662. See [requirements](#requirements) if you aren't
sure whether you have this.

For vim-plug

```viml
call plug#begin()

Plug 'Shougo/ddu.vim'
Plug 'vim-denops/denops.vim'

" Install your UIs

" Install your sources

" Install your filters

" Install your kinds

call plug#end()
```

For dein.vim

```viml
call dein#begin()

call dein#add('Shougo/ddu.vim')
call dein#add('vim-denops/denops.vim')

" Install your UIs

" Install your sources

" Install your filters

" Install your kinds

call dein#end()
```

**Note:** Ddu.vim does not include any UIs, sources, filters and kinds.
You must install them you want manually.
You can search ddu plugins(sources and filters) from
[here](https://github.com/topics/ddu-vim).



### Requirements

Ddu.vim requires both Deno and denops.vim.

- <https://deno.land/>
- <https://github.com/vim-denops/denops.vim>


## Configuration

```vim
" Set default sources
call ddu#custom#patch_global({
    \ 'sources': [{'name': 'file', 'params': {}}],
    \ })

" Call default sources
call ddu#start({})

" Set buffer-name specific configuration
call ddu#custom#patch_buffer('files', {
    \ 'sources': [
    \   {'name': 'file', 'params': {}},
    \   {'name': 'file_old', 'params': {}},
    \ ],
    \ })

" Specify buffer name
call ddu#start({'uiOptions': {'buffer_name': 'files'}})
```

See `:help ddu-options` for a complete list of options.


## Screenshots

## Plans

