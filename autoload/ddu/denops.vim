function ddu#denops#_running() abort
  return 'g:loaded_denops'->exists()
        \ && denops#server#status() ==# 'running'
        \ && denops#plugin#is_loaded('ddu')
endfunction

function ddu#denops#_request(method, args) abort
  if s:init()
    return {}
  endif

  if !ddu#denops#_running()
    " Lazy call
    execute printf('autocmd User DenopsPluginPost:ddu call '
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
    execute printf('autocmd User DenopsPluginPost:ddu call '
          \ .. 's:notify("%s", %s)', a:method, a:args->string())
    return {}
  endif

  return s:notify(a:method, a:args)
endfunction

function ddu#denops#_load(name, path) abort
  try
    call denops#plugin#load(a:name, a:path)
  catch /^Vim\%((\a\+)\)\=:E117:/
    " Fallback to `register` for backward compatibility
    call denops#plugin#register(a:name, a:path, #{ mode: 'skip' })
  endtry
endfunction

const s:root_dir = '<sfile>'->expand()->fnamemodify(':h:h:h')
const s:sep = has('win32') ? '\' : '/'
function s:register() abort
  if !'g:ddu#_mods'->exists()
    const g:ddu#_mods = [s:root_dir, 'denops', 'ddu', '_mods.js']->join(s:sep)
  endif

  call ddu#denops#_load('ddu',
        \ [s:root_dir, 'denops', 'ddu', 'app.ts']->join(s:sep))

  autocmd ddu User DenopsClosed call s:stopped()
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

  if !has('patch-9.0.1276') && !has('nvim-0.8')
    call ddu#util#print_error(
          \ 'ddu requires Vim 9.0.1276+ or neovim 0.8.0+.')
    return 1
  endif

  augroup ddu
    autocmd!
    autocmd User DenopsPluginPost:ddu let g:ddu#_initialized = v:true
    autocmd User Ddu:redraw,Ddu:uiReady :
  augroup END

  let g:ddu#_started = reltime()

  " NOTE: ddu.vim must be registered manually.

  " NOTE: denops load may be started
  if 'g:loaded_denops'->exists() &&
        \ ('<amatch>'->expand() ==# 'DenopsReady' ||
        \  denops#server#status() ==# 'running')
    call s:register()
  else
    autocmd ddu User DenopsReady call s:register()
  endif
endfunction
