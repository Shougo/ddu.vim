function ddu#denops#_running() abort
  return 'g:loaded_denops'->exists()
        \ && denops#server#status() ==# 'running'
        \ && denops#plugin#is_loaded('ddu')
endfunction

function ddu#denops#_request(method, args) abort
  if s:init()
    return {}
  endif

  if denops#server#status() !=# 'running'
    " Lazy call
    execute printf('autocmd User DenopsPluginPost:ddu ++nested call '
          \ .. 's:notify("%s", %s)', a:method, a:args->string())
    return {}
  endif

  if denops#plugin#wait('ddu')
    return {}
  endif
  return denops#request('ddu', a:method, a:args)
endfunction
function ddu#denops#_notify(method, args) abort
  if s:init()
    return {}
  endif

  if !ddu#denops#_running()
    " Lazy call
    execute printf('autocmd User DenopsPluginPost:ddu ++nested call '
          \ .. 's:notify("%s", %s)', a:method, a:args->string())
    return {}
  endif

  return s:notify(a:method, a:args)
endfunction

const s:root_dir = '<sfile>'->expand()->fnamemodify(':h:h:h')
const s:sep = has('win32') ? '\' : '/'
function ddu#denops#_mods() abort
  return [s:root_dir, 'denops', 'ddu', '_mods.js']->join(s:sep)
endfunction
function s:register() abort
  call denops#plugin#load('ddu',
        \ [s:root_dir, 'denops', 'ddu', 'app.ts']->join(s:sep))

  autocmd ddu User DenopsClosed ++nested call s:stopped()
endfunction
function s:stopped() abort
  unlet! g:ddu#_initialized

  " Restore custom config
  for custom in g:->get('ddu#_notifies', [])
    call ddu#denops#_notify(custom.method, custom.args)
  endfor
  for custom in g:->get('ddu#denops#_requests', [])
    call ddu#denops#_request(custom.method, custom.args)
  endfor
endfunction

function s:notify(method, args) abort
  if denops#plugin#is_loaded('ddu')
    call denops#notify('ddu', a:method, a:args)
  else
    call denops#plugin#wait_async('ddu',
          \ { -> denops#notify('ddu', a:method, a:args) })
  endif
endfunction

function s:init() abort
  if 'g:ddu#_initialized'->exists()
    return
  endif

  if !has('patch-9.1.0448') && !has('nvim-0.10')
    call ddu#util#print_error(
          \ 'ddu requires Vim 9.1.0448+ or neovim 0.10.0+.')
    return 1
  endif

  augroup ddu
    autocmd!
    autocmd User DenopsPluginPost:ddu ++nested
          \ let g:ddu#_initialized = v:true
    autocmd User Ddu:redraw,Ddu:uiReady,Ddu:uiDone ++nested :
  augroup END

  let g:ddu#_started = reltime()

  " NOTE: ddu.vim must be registered manually.

  " NOTE: denops load may be started
  if 'g:loaded_denops'->exists()
    if denops#server#status() ==# 'running'
      call s:register()
      return
    endif

    try
      if '<amatch>'->expand() ==# 'DenopsReady'
        call s:register()
        return
      endif
    catch /^Vim\%((\a\+)\)\=:E497:/
      " NOTE: E497 is occured when it is not in autocmd.
    endtry
  endif

  autocmd ddu User DenopsReady ++nested call s:register()
endfunction
