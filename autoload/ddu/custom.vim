function! ddu#custom#patch_global(key_or_dict, value = '') abort
  const dict = s:normalize_key_or_dict(a:key_or_dict, a:value)
  call s:notify('patchGlobal', [dict])
endfunction
function! ddu#custom#patch_local(name, key_or_dict, value = '') abort
  const dict = s:normalize_key_or_dict(a:key_or_dict, a:value)
  call s:notify('patchLocal', [dict, a:name])
endfunction

function! ddu#custom#set_global(dict) abort
  call s:notify('setGlobal', [a:dict])
endfunction
function! ddu#custom#set_local(name, dict) abort
  call s:notify('setLocal', [a:dict, a:name])
endfunction

function! ddu#custom#load_config(path) abort
  return s:notify('loadConfig', [a:path])
endfunction

let s:aliases = #{
      \   ui: {},
      \   source: {},
      \   filter: {},
      \   kind: {},
      \   column: {},
      \   action: {},
      \ }
function! ddu#custom#alias(type, alias, base) abort
  if !(s:aliases->has_key(a:type))
    call ddu#util#print_error('Invalid alias type: ' .. a:type)
    return
  endif

  let s:aliases[a:type][a:alias] = a:base
  call s:notify('alias', [a:type, a:alias, a:base])
endfunction

let s:custom_actions = #{
      \   ui: {},
      \   source: {},
      \   kind: {},
      \ }
function! ddu#custom#action(type, source_kind_name, action_name, func) abort
  let dict = s:custom_actions[a:type]

  for key in a:source_kind_name->split('\s*,\s*')
    if !(dict->has_key(key))
      let dict[key] = #{ actions: {} }
    endif
    let dict[key].actions[a:action_name] = denops#callback#register(a:func)
  endfor

  call s:notify('patchGlobal', [
        \   a:type ==# 'ui' ?     #{ uiOptions: dict } :
        \   a:type ==# 'source' ? #{ sourceOptions: dict } :
        \                         #{ kindOptions: dict }
        \ ])
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
function! ddu#custom#get_current(name) abort
  return ddu#_request('getCurrent', [a:name])
endfunction
function! ddu#custom#get_aliases() abort
  return s:aliases
endfunction

function! s:normalize_key_or_dict(key_or_dict, value) abort
  if a:key_or_dict->type() == v:t_dict
    return a:key_or_dict
  elseif a:key_or_dict->type() == v:t_string
    let base = {}
    let base[a:key_or_dict] = a:value
    return base
  endif
  return {}
endfunction

function! s:normalize_string_or_list(string_or_list) abort
  if a:string_or_list->type() == v:t_list
    return a:string_or_list
  elseif a:string_or_list->type() == v:t_string
    return [a:string_or_list]
  endif
  return []
endfunction

function! s:notify(method, args) abort
  " Save notify args
  if !('g:ddu#_customs'->exists())
    let g:ddu#_customs = []
  endif

  call add(g:ddu#_customs, #{ method: a:method, args: a:args })

  return ddu#_notify(a:method, a:args)
endfunction
