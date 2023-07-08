# ddu.vim

> Dark deno-powered UI framework for neovim/Vim8

If you don't want to configure plugins, you don't have to use the plugin. It
does not work with zero configuration. You can use other plugins.

[![Doc](https://img.shields.io/badge/doc-%3Ah%20ddu-orange.svg)](doc/ddu.txt)

Please read [help](doc/ddu.txt) for details.

NOTE: I have created
[Japanese article](https://zenn.dev/shougo/articles/ddu-vim-beta) for ddu.vim.

Ddu is the abbreviation of "dark deno-powered UI". It provides an extensible and
asynchronous UI framework for neovim/Vim8.

The development is supported by
[github sponsors](https://github.com/sponsors/Shougo/). Thank you!

<!-- vim-markdown-toc GFM -->

- [Introduction](#introduction)
- [Install](#install)
  - [Requirements](#requirements)
- [Configuration](#configuration)
- [Screenshots](#screenshots)

<!-- vim-markdown-toc -->

## Introduction

I have chosen denops.vim framework to create new plugin. Because denops.vim is
better than neovim Python interface.

- Easy to setup
- Minimal dependency
- Stability
- neovim/Vim8 compatibility
- Speed
- Library
- Easy to hack

## Install

**NOTE:** Ddu.vim requires Neovim (0.8.0+ and of course, **latest** is
recommended) or Vim 9.0.1276+. See [requirements](#requirements) if you aren't
sure whether you have this.

For vim-plug

```vim
call plug#begin()

Plug 'vim-denops/denops.vim'
Plug 'Shougo/ddu.vim'

" Install your UIs

" Install your sources

" Install your filters

" Install your kinds

" Install your columns

call plug#end()
```

For dein.vim

```vim
call dein#begin()

call dein#add('vim-denops/denops.vim')
call dein#add('Shougo/ddu.vim')

" Install your UIs

" Install your sources

" Install your filters

" Install your kinds

" Install your columns

call dein#end()
```

**NOTE:** Ddu.vim does not include any extra plugins. You must install them you
want manually. You can search ddu plugins from
[here](https://github.com/topics/ddu-vim).

### Requirements

Ddu.vim requires both Deno and denops.vim.

- <https://deno.land/>
- <https://github.com/vim-denops/denops.vim>

## Configuration

```vim
" You must set the default ui.
" NOTE: ff ui
" https://github.com/Shougo/ddu-ui-ff
call ddu#custom#patch_global({
    \ 'ui': 'ff',
    \ })

" You must set the default action.
" NOTE: file kind
" https://github.com/Shougo/ddu-kind-file
call ddu#custom#patch_global({
    \   'kindOptions': {
    \     'file': {
    \       'defaultAction': 'open',
    \     },
    \   }
    \ })

" Specify matcher.
" NOTE: matcher_substring filter
" https://github.com/Shougo/ddu-filter-matcher_substring
call ddu#custom#patch_global({
    \   'sourceOptions': {
    \     '_': {
    \       'matchers': ['matcher_substring'],
    \     },
    \   }
    \ })

" Set default sources
" NOTE: file source
" https://github.com/Shougo/ddu-source-file
"call ddu#custom#patch_global({
"    \ 'sources': [{'name': 'file', 'params': {}}],
"    \ })

" Call default sources
"call ddu#start({})

" Set name specific configuration
"call ddu#custom#patch_local('files', {
"    \ 'sources': [
"    \   {'name': 'file', 'params': {}},
"    \   {'name': 'file_old', 'params': {}},
"    \ ],
"    \ })

" Specify name
"call ddu#start({'name': 'files'})

" Specify source with params
" NOTE: file_rec source
" https://github.com/Shougo/ddu-source-file_rec
"call ddu#start({'sources': [
"    \ {'name': 'file_rec', 'params': {'path': expand('~')}}
"    \ ]})
```

See `:help ddu-options` for a complete list of options.

## Screenshots

Please see: https://github.com/Shougo/ddu.vim/issues/10

![ddu.vim](https://user-images.githubusercontent.com/41495/154783539-469f773a-ab05-437e-9827-9cc6d1444f80.png)

## Plans

- [ ] XXX
