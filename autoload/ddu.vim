function ddu#start(options = {}) abort
  " You cannot use ddu.vim in the command line window.
  if getcmdwintype() !=# ''
    call ddu#util#print_error(
          \ 'You cannot call ddu.vim in the command line window.')
    return
  endif

  if a:options->get('sync', v:false)
    call ddu#denops#_request('start', [a:options])
  else
    call ddu#denops#_notify('start', [a:options])
  endif
endfunction
function ddu#redraw(name, options = {}) abort
  if a:name ==# ''
    return
  endif
  call ddu#denops#_notify('redraw', [a:name, a:options])
endfunction
function ddu#redraw_tree(name, mode, items) abort
  if a:name ==# ''
    return
  endif
  call ddu#denops#_notify('redrawTree', [a:name, a:mode, a:items])
endfunction
function ddu#event(name, event) abort
  if a:name ==# ''
    return
  endif
  call ddu#denops#_request('event', [a:name, a:event])
endfunction
function ddu#pop(name, options = {}) abort
  if a:name ==# ''
    return
  endif
  if a:options->get('sync', v:false)
    call ddu#denops#_request('pop', [a:name, a:options])
  else
    call ddu#denops#_notify('pop', [a:name, a:options])
  endif
endfunction
function ddu#ui_async_action(name, action, params = {}) abort
  if a:name ==# ''
    return
  endif
  call ddu#denops#_notify('uiAction', [a:name, a:action, a:params])
endfunction
function ddu#ui_sync_action(name, action, params = {}) abort
  if a:name ==# ''
    return
  endif
  call ddu#denops#_request('uiAction', [a:name, a:action, a:params])
endfunction
function ddu#item_action(name, action, items, params = {}) abort
  call ddu#denops#_request(
        \ 'itemAction', [a:name, a:action, a:items, a:params])
endfunction
function ddu#get_context(name) abort
  if a:name ==# ''
    return
  endif
  return ddu#denops#_request('getContext', [a:name])
endfunction
function ddu#register(name, type, path) abort
  call ddu#denops#_notify('registerPath', [a:name, a:type, a:path])
endfunction
function ddu#load(name, type, ext_names) abort
  call ddu#denops#_notify('loadExtensions', [a:name, a:type, a:ext_names])
endfunction

function ddu#get_items(options = {}) abort
  return ddu#denops#_request('getItems', [a:options])
endfunction

function ddu#_lazy_redraw(name, args = {}) abort
  call timer_start(0, { -> ddu#redraw(a:name, a:args) })
endfunction
