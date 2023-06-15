function ddu#ui#async_action(name, options = {}) abort
  call ddu#ui_async_action(get(b:, 'ddu_ui_name', ''), a:name, a:options)
endfunction

function ddu#ui#sync_action(name, options = {}) abort
  call ddu#ui_sync_action(get(b:, 'ddu_ui_name', ''), a:name, a:options)
endfunction

function ddu#ui#do_action(name, options = {}) abort
  return ddu#ui#sync_action(a:name, a:options)
endfunction

function ddu#ui#multi_actions(actions) abort
  for action in a:actions
    call call('ddu#ui#sync_action', action)
  endfor
endfunction

function ddu#ui#get_item() abort
  call ddu#ui_sync_action(get(b:, 'ddu_ui_name', ''), 'getItem', {})
  return b:->get('ddu_ui_item', {})
endfunction

function ddu#ui#get_selected_items() abort
  call ddu#ui_sync_action(get(b:, 'ddu_ui_name', ''), 'getSelectedItems', {})
  return b:->get('ddu_ui_selected_items', [])
endfunction

function ddu#ui#visible(name, tabnr = tabpagenr()) abort
  return ddu#_request('uiVisible', [a:name, a:tabnr])
endfunction

function ddu#ui#winid(name) abort
  return ddu#_request('uiWinid', [a:name])
endfunction
