# ddu.vim

> Dark deno-powered UI framework for neovim/Vim

If you don't want to configure plugins, you don't have to use the plugin. It
does not work with zero configuration. You can use other plugins.

[![Doc](https://img.shields.io/badge/doc-%3Ah%20ddu-orange.svg)](doc/ddu.txt)

Please read [help](doc/ddu.txt) for details.

NOTE: I have created
[Japanese article](https://zenn.dev/shougo/articles/ddu-vim-beta) for ddu.vim.

Ddu is the abbreviation of "dark deno-powered UI". It provides an extensible and
asynchronous UI framework for neovim/Vim.

The development is supported by
[github sponsors](https://github.com/sponsors/Shougo/). Thank you!

<!-- vim-markdown-toc GFM -->

- [Introduction](#introduction)
- [Screenshots](#screenshots)
- [Install](#install)

<!-- vim-markdown-toc -->

## Introduction

I have chosen denops.vim framework to create new plugin. Because denops.vim is
better than neovim Python interface.

- Easy to setup
- Minimal dependency
- Stability
- neovim/Vim compatibility
- Speed
- Library
- Easy to hack

## Screenshots

Please see: https://github.com/Shougo/ddu.vim/issues/10

![ddu.vim](https://user-images.githubusercontent.com/41495/154783539-469f773a-ab05-437e-9827-9cc6d1444f80.png)

## Install

**NOTE:** Ddu.vim requires Neovim (0.8.0+ and of course, **latest** is
recommended) or Vim 9.0.1276+. See [requirements](#requirements) if you aren't
sure whether you have this.

### Requirements

Ddu.vim requires both Deno 1.38+ and denops.vim.

- <https://deno.land/>
- <https://github.com/vim-denops/denops.vim>

**NOTE:** Ddu.vim does not include any extra plugins. You must install them you
want manually. You can search ddu plugins from
[here](https://github.com/topics/ddu-vim).
