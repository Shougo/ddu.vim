const s:root_dir = '<sfile>'->expand()->fnamemodify(':h:h:h')
const s:sep = has('win32') ? '\' : '/'
function ddu#denops#_register() abort
  if !'g:ddu#_mods'->exists()
    const g:ddu#_mods = [s:root_dir, 'denops', 'ddu', '_mods.js']->join(s:sep)
  endif

  call ddu#denops#_load('ddu',
        \ [s:root_dir, 'denops', 'ddu', 'app.ts']->join(s:sep))

  autocmd ddu User DenopsClosed call s:stopped()
endfunction
function ddu#denops#_load(name, path) abort
  try
    call denops#plugin#load(a:name, a:path)
  catch /^Vim\%((\a\+)\)\=:E117:/
    " Fallback to `register` for backward compatibility
    call denops#plugin#register(a:name, a:path, #{ mode: 'skip' })
  endtry
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

function ddu#denops#_running() abort
  return 'g:loaded_denops'->exists()
        \ && denops#server#status() ==# 'running'
        \ && denops#plugin#is_loaded('ddu')
endfunction

function ddu#denops#_request(method, args) abort
  if ddu#_init()
    return {}
  endif

  if !ddu#denops#_running()
    " Lazy call request
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
  if ddu#_init()
    return {}
  endif

  if !ddu#denops#_running()
    " Lazy call notify
    execute printf('autocmd User DenopsPluginPost:ddu call '
          \ .. 's:notify("%s", %s)', a:method, a:args->string())
    return {}
  endif

  return s:notify(a:method, a:args)
endfunction

function s:notify(method, args) abort
  if denops#plugin#is_loaded('ddu')
    call denops#notify('ddu', a:method, a:args)
  else
    call denops#plugin#wait_async('ddu',
          \ { -> denops#notify('ddu', a:method, a:args) })
  endif
endfunction
