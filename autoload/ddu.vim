function! ddu#start(...) abort
  call ddu#_request('start', [get(a:000, 0, {})])
endfunction
function! ddu#redraw(name, ...) abort
  call ddu#_notify('redraw', [a:name, get(a:000, 0, {})])
endfunction
function! ddu#event(name, event) abort
  call ddu#_request('event', [a:name, a:event])
endfunction
function! ddu#pop(name) abort
  call ddu#_notify('pop', [a:name])
endfunction
function! ddu#ui_action(name, action, params) abort
  call ddu#_request('uiAction', [a:name, a:action, a:params])
endfunction
function! ddu#item_action(name, action, items, params) abort
  call ddu#_request('itemAction', [a:name, a:action, a:items, a:params])
endfunction
function! ddu#get_item_actions(name, items) abort
  return ddu#_request('getItemActions', [a:name, a:items])
endfunction

function! ddu#_request(name, args) abort
  if ddu#_init()
    return {}
  endif

  call denops#plugin#wait('ddu')
  return denops#request('ddu', a:name, a:args)
endfunction
function! ddu#_notify(name, args) abort
  if ddu#_init()
    return {}
  endif

  call denops#plugin#wait('ddu')
  return denops#notify('ddu', a:name, a:args)
endfunction

function! ddu#_init() abort
  if exists('g:ddu#_initialized')
    return
  endif

  if !has('patch-8.2.0662') && !has('nvim-0.6')
    call ddu#util#print_error(
          \ 'ddu requires Vim 8.2.0662+ or neovim 0.6.0+.')
    return 1
  endif

  augroup ddu
    autocmd!
  augroup END

  " Note: ddu.vim must be registered manually.

  " Note: denops load may be started
  if exists('g:loaded_denops') && denops#server#status() ==# 'running'
    silent! call ddu#_register()
  else
    autocmd ddu User DenopsReady silent! call ddu#_register()
  endif
endfunction

let s:root_dir = fnamemodify(expand('<sfile>'), ':h:h')
function! ddu#_register() abort
  call denops#plugin#register('ddu',
        \ denops#util#join_path(s:root_dir, 'denops', 'ddu', 'app.ts'),
        \ { 'mode': 'skip' })
endfunction

function! ddu#_denops_running() abort
  return exists('g:loaded_denops')
        \ && denops#server#status() ==# 'running'
        \ && denops#plugin#is_loaded('ddu')
endfunction
