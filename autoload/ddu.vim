function ddu#start(options = {}) abort
  " You cannot use ddu.vim in the command line window.
  if getcmdwintype() !=# ''
    call ddu#util#print_error(
          \ 'You cannot call ddu.vim in the command line window.')
    return
  endif

  call ddu#_notify('start', [a:options])
endfunction
function ddu#redraw(name, options = {}) abort
  if a:name ==# ''
    return
  endif
  call ddu#_notify('redraw', [a:name, a:options])
endfunction
function ddu#redraw_tree(name, mode, items) abort
  if a:name ==# ''
    return
  endif
  call ddu#_notify('redrawTree', [a:name, a:mode, a:items])
endfunction
function ddu#event(name, event) abort
  if a:name ==# ''
    return
  endif
  call ddu#_request('event', [a:name, a:event])
endfunction
function ddu#pop(name, options = {}) abort
  if a:name ==# ''
    return
  endif
  if a:options->get('sync', v:false)
    call ddu#_request('pop', [a:name, a:options])
  else
    call ddu#_notify('pop', [a:name, a:options])
  endif
endfunction
function ddu#ui_async_action(name, action, params = {}) abort
  if a:name ==# ''
    return
  endif
  call ddu#_notify('uiAction', [a:name, a:action, a:params])
endfunction
function ddu#ui_sync_action(name, action, params = {}) abort
  if a:name ==# ''
    return
  endif
  call ddu#_request('uiAction', [a:name, a:action, a:params])
endfunction
function ddu#item_action(name, action, items, params = {}) abort
  if a:name ==# ''
    return
  endif
  call ddu#_request('itemAction', [a:name, a:action, a:items, a:params])
endfunction
function ddu#get_item_actions(name, items) abort
  if a:name ==# ''
    return
  endif
  return ddu#_request('getItemActions', [a:name, a:items])
endfunction
function ddu#get_context(name) abort
  if a:name ==# ''
    return
  endif
  return ddu#_request('getContext', [a:name])
endfunction
function ddu#register(type, path) abort
  call ddu#_notify('register', [a:type, a:path])
endfunction

function ddu#_request(method, args) abort
  if s:init()
    return {}
  endif

  if !'g:loaded_denops'->exists()
    echohl WarningMsg
    echomsg '[ddu] The ddu#_request() is called but denops.vim is not in runtimepath so ddu cannot return proper result of the request.'
    echomsg '[ddu] Consider to use ddu#_notify() instead if the result is not actually required.'
    echohl None
    execute printf(
          \ 'autocmd User DenopsPluginPost:ddu ++once call s:notify("%s", %s)',
          \ a:method,
          \ a:args->string(),
          \)
    return {}
  endif
  return s:request(a:method, a:args)
endfunction

function s:request(method, args) abort
  if denops#plugin#wait('ddu')
    return {}
  endif
  return denops#request('ddu', a:method, a:args)
endfunction

function ddu#_notify(method, args) abort
  if s:init()
    return {}
  endif

  if !'g:loaded_denops'->exists()
    execute printf(
          \ 'autocmd User DenopsPluginPost:ddu ++once call s:notify("%s", %s)',
          \ a:method,
          \ a:args->string(),
          \)
    return
  endif
  call s:notify(a:method, a:args)
endfunction

function s:notify(method, args) abort
  if denops#plugin#is_loaded('ddu')
    call denops#notify('ddu', a:method, a:args)
    return
  endif
  call denops#plugin#wait_async('ddu', { -> denops#notify('ddu', a:method, a:args) })
endfunction

const s:root_dir = '<sfile>'->expand()->fnamemodify(':h:h')
const s:sep = has('win32') ? '\' : '/'
function ddu#_register() abort
  call denops#plugin#register('ddu',
        \ [s:root_dir, 'denops', 'ddu', 'app.ts']->join(s:sep),
        \ #{ mode: 'skip' })

  autocmd ddu User DenopsClosed call s:stopped()
endfunction

function ddu#_denops_running() abort
  return 'g:loaded_denops'->exists()
        \ && denops#server#status() ==# 'running'
        \ && denops#plugin#is_loaded('ddu')
endfunction

function ddu#_lazy_redraw(name, args = {}) abort
  call timer_start(0, { -> ddu#redraw(a:name, a:args) })
endfunction

function s:init() abort
  if 's:initialized'->exists()
    return
  endif

  if v:version < 900 && !has('nvim-0.8')
    call ddu#util#print_error(
          \ 'ddu requires Vim 9.0+ or neovim 0.8.0+.')
    return 1
  endif

  let g:ddu#_started = reltime()

  " NOTE: ddu.vim must be registered manually.

  " NOTE: denops load may be started
  if !'g:loaded_denops'->exists()
    autocmd User DenopsReady ++once silent! call ddu#_register()
    return
  endif
  silent! call ddu#_register()
endfunction

function s:stopped() abort
  unlet! s:initialized

  " Restore custom config
  for custom in g:->get('ddu#_notifies', [])
    call ddu#_notify(custom.method, custom.args)
  endfor
  for custom in g:->get('ddu#_requests', [])
    call ddu#_request(custom.method, custom.args)
  endfor
endfunction

augroup ddu
  autocmd!
  autocmd User DenopsPluginPost:ddu ++once let s:initialized = v:true
augroup END
