function! ddu#ui#do_action(name, options = {}) abort
  if !('b:ddu_ui_name'->exists())
    return
  endif

  call ddu#ui_action(b:ddu_ui_name, a:name, a:options)
endfunction

function! ddu#ui#multi_actions(actions) abort
  if !('b:ddu_ui_name'->exists())
    return
  endif

  for action in a:actions
    call call('ddu#ui#do_action', action)
  endfor
endfunction

function! ddu#ui#get_item() abort
  if !('b:ddu_ui_name'->exists())
    return {}
  endif

  call ddu#ui_action(b:ddu_ui_name, 'getItem', {})

  return b:->get('ddu_ui_item', {})
endfunction

function! ddu#ui#get_selected_items() abort
  if !('b:ddu_ui_name'->exists())
    return []
  endif

  call ddu#ui_action(b:ddu_ui_name, 'getSelectedItems', {})

  return b:->get('ddu_ui_selected_items', [])
endfunction

function! ddu#ui#visible(name, tabnr = tabpagenr()) abort
  return ddu#_request('uiVisible', [a:name, a:tabnr])
endfunction

function! ddu#ui#winid(name) abort
  return ddu#_request('uiWinid', [a:name])
endfunction
