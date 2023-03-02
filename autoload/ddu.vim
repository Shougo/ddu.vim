function! ddu#start(options = {}) abort
  call ddu#_notify('start', [a:options])
endfunction
function! ddu#redraw(name, options = {}) abort
  call ddu#_notify('redraw', [a:name, a:options])
endfunction
function! ddu#redraw_tree(name, mode, items) abort
  return ddu#_notify('redrawTree', [a:name, a:mode, a:items])
endfunction
function! ddu#event(name, event) abort
  call ddu#_request('event', [a:name, a:event])
endfunction
function! ddu#pop(name, options = {}) abort
  call ddu#_request('pop', [a:name, a:options])
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
function! ddu#get_previewer(name, item, params, context) abort
  return ddu#_request('getPreviewer', [a:name, a:item, a:params, a:context])
endfunction

function! ddu#_request(method, args) abort
  if s:init()
    return {}
  endif

  " Note: If call denops#plugin#wait() in vim_starting, freezed!
  if has('vim_starting')
    call ddu#util#print_error(
          \ 'You cannot call ddu.vim in vim_starting.')
    return {}
  endif

  " You cannot use ddu.vim in the command line window.
  if getcmdwintype() !=# ''
    call ddu#util#print_error(
          \ 'You cannot call ddu.vim in the command line window.')
    return {}
  endif

  if denops#plugin#wait('ddu')
    return {}
  endif
  return denops#request('ddu', a:method, a:args)
endfunction
function! ddu#_notify(method, args) abort
  if s:init()
    return {}
  endif

  if ddu#_denops_running()
    if denops#plugin#wait('ddu')
      return {}
    endif
    call denops#notify('ddu', a:method, a:args)
  else
    " Lazy call notify
    execute printf('autocmd User DDUReady call ' .
          \ 'denops#notify("ddu", "%s", %s)',
          \ a:method, string(a:args))
  endif

  return {}
endfunction

function! s:init() abort
  if 'g:ddu#_initialized'->exists()
    return
  endif

  if !has('patch-8.2.0662') && !has('nvim-0.8')
    call ddu#util#print_error(
          \ 'ddu requires Vim 8.2.0662+ or neovim 0.8.0+.')
    return 1
  endif

  augroup ddu
    autocmd!
    autocmd User DDUReady :
  augroup END

  " Note: ddu.vim must be registered manually.

  " Note: denops load may be started
  autocmd ddu User DenopsReady silent! call ddu#_register()
  if 'g:loaded_denops'->exists() && denops#server#status() ==# 'running'
    silent! call ddu#_register()
  endif
endfunction

let s:root_dir = '<sfile>'->expand()->fnamemodify(':h:h')
let s:sep = has('win32') ? '\' : '/'
function! ddu#_register() abort
  call denops#plugin#register('ddu',
        \ [s:root_dir, 'denops', 'ddu', 'app.ts']->join(s:sep),
        \ #{ mode: 'skip' })

  autocmd ddu User DenopsClosed call s:stopped()
endfunction

function! s:stopped() abort
  unlet! g:ddu#_initialized

  " Restore custom config
  if 'g:ddu#_customs'->exists()
    for custom in g:ddu#_customs
      call ddu#_notify(custom.method, custom.args)
    endfor
  endif
endfunction

function! ddu#_denops_running() abort
  return 'g:loaded_denops'->exists()
        \ && denops#server#status() ==# 'running'
        \ && denops#plugin#is_loaded('ddu')
endfunction

function! ddu#_lazy_redraw(name, args = {}) abort
  call timer_start(0, { -> ddu#redraw(a:name, a:args) })
endfunction
