function ddu#custom#patch_global(key_or_dict, value = '') abort
  const dict = s:normalize_key_or_dict(a:key_or_dict, a:value)
  call s:notify('patchGlobal', [dict])
endfunction
function ddu#custom#patch_local(name, key_or_dict, value = '') abort
  const dict = s:normalize_key_or_dict(a:key_or_dict, a:value)
  call s:notify('patchLocal', [dict, a:name])
endfunction

function ddu#custom#set_global(dict) abort
  call s:notify('setGlobal', [a:dict])
endfunction
function ddu#custom#set_local(name, dict) abort
  call s:notify('setLocal', [a:dict, a:name])
endfunction

function ddu#custom#load_config(path) abort
  if !a:path->filereadable()
    call ddu#util#print_error(printf('"%s" is not found.', a:path))
    return
  endif

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
function ddu#custom#alias(name, type, alias, base) abort
  if !s:aliases->has_key(a:type)
    call ddu#util#print_error('Invalid alias type: ' .. a:type)
    return
  endif

  call s:notify('alias', [a:name, a:type, a:alias, a:base])
endfunction

let s:custom_actions = #{
      \   ui: {},
      \   source: {},
      \   kind: {},
      \ }
function ddu#custom#action(type, source_kind_name, action_name, func) abort
  if !s:custom_actions->has_key(a:type)
    call ddu#util#print_error('Invalid custom action type: ' .. a:type)
    return
  endif

  let dict = s:custom_actions[a:type]

  for key in a:source_kind_name->split('\s*,\s*')
    if !dict->has_key(key)
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

" This should be called manually, so wait until DenopsPluginPost:ddu by the
" user himself.
function ddu#custom#get_global() abort
  return s:request('getGlobal', [])
endfunction
function ddu#custom#get_local() abort
  return s:request('getLocal', [])
endfunction
function ddu#custom#get_default_options() abort
  return s:request('getDefaultOptions', [])
endfunction
function ddu#custom#get_current(name = b:->get('ddu_ui_name', '')) abort
  return a:name ==# '' ? {} : s:request('getCurrent', [a:name])
endfunction
function ddu#custom#get_names() abort
  return s:request('getNames', [])
endfunction
function ddu#custom#get_source_names(name) abort
  return s:request('getSourceNames', [a:name])
endfunction
function ddu#custom#get_alias_names(name, type) abort
  return s:request('getAliasNames', [a:name, a:type])
endfunction

function s:normalize_key_or_dict(key_or_dict, value) abort
  if a:key_or_dict->type() == v:t_dict
    return a:key_or_dict
  elseif a:key_or_dict->type() == v:t_string
    if a:key_or_dict ==# ''
      throw 'ddu#custom: key must not be empty.'
    endif

    let base = {}
    let base[a:key_or_dict] = a:value
    return base
  endif

  throw printf(
        \   'ddu#custom: "key_or_dict" must be Dict or String, got %s',
        \   type(a:key_or_dict)
        \ )
endfunction

function s:notify(method, args) abort
  " Save args
  if !'g:ddu#_notifies'->exists()
    let g:ddu#_notifies = []
  endif
  call add(g:ddu#_notifies, #{ method: a:method, args: a:args })

  return ddu#denops#_notify(a:method, a:args)
endfunction

function s:request(method, args) abort
  " Save args
  if !'g:ddu#denops#_requests'->exists()
    let g:ddu#denops#_requests = []
  endif
  call add(g:ddu#denops#_requests, #{ method: a:method, args: a:args })

  return ddu#denops#_request(a:method, a:args)
endfunction
