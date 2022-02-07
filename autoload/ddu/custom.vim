function! ddu#custom#patch_global(key_or_dict, ...) abort
  if a:0 > 1
    call ddu#util#print_error('The args is too much: ' . string(a:000))
  endif
  let dict = s:normalize_key_or_dict(a:key_or_dict, get(a:000, 0, ''))
  call s:notify('patchGlobal', [dict])
endfunction
function! ddu#custom#patch_local(name, key_or_dict, ...) abort
  if a:0 > 1
    call ddu#util#print_error('The args is too much: ' . string(a:000))
  endif
  let dict = s:normalize_key_or_dict(a:key_or_dict, get(a:000, 0, ''))
  call s:notify('patchLocal', [dict, a:name])
endfunction

function! ddu#custom#set_global(dict) abort
  call s:notify('setGlobal', [a:dict])
endfunction
function! ddu#custom#set_local(name, dict) abort
  call s:notify('setLocal', [a:dict, a:name])
endfunction

function! ddu#custom#alias(type, alias, base) abort
  call s:notify('alias', [a:type, a:alias, a:base])
endfunction

" This should be called manually, so wait until dduReady by the user himself.
function! ddu#custom#get_global() abort
  return ddu#_request('getGlobal', [])
endfunction
function! ddu#custom#get_local() abort
  return ddu#_request('getLocal', [])
endfunction
function! ddu#custom#get_default_options() abort
  return ddu#_request('getDefaultOptions', [])
endfunction

function! s:notify(method, args) abort
  if ddu#_denops_running()
    call denops#notify('ddu', a:method, a:args)
  else
    execute printf('autocmd User DDUReady call ' .
          \ 'denops#notify("ddu", "%s", %s)',
          \ a:method, string(a:args))
  endif
endfunction

function! s:normalize_key_or_dict(key_or_dict, value) abort
  if type(a:key_or_dict) == v:t_dict
    return a:key_or_dict
  elseif type(a:key_or_dict) == v:t_string
    let base = {}
    let base[a:key_or_dict] = a:value
    return base
  endif
  return {}
endfunction

function! s:normalize_string_or_list(string_or_list) abort
  if type(a:string_or_list) == v:t_list
    return a:string_or_list
  elseif type(a:string_or_list) == v:t_string
    return [a:string_or_list]
  endif
  return []
endfunction
