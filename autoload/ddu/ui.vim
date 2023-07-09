function ddu#ui#async_action(name, params = {}) abort
  call ddu#ui_async_action(get(b:, 'ddu_ui_name', ''), a:name, a:params)
endfunction

function ddu#ui#sync_action(name, params = {}) abort
  call ddu#ui_sync_action(get(b:, 'ddu_ui_name', ''), a:name, a:params)
endfunction

function ddu#ui#do_action(name, params = {}) abort
  return ddu#ui#sync_action(a:name, a:params)
endfunction

function ddu#ui#multi_actions(actions) abort
  for action in a:actions
    call call('ddu#ui#sync_action', action)
  endfor
endfunction

function ddu#ui#get_item(name=get(b:, 'ddu_ui_name', '')) abort
  call ddu#ui_sync_action(a:name, 'getItem', {})
  return b:->get('ddu_ui_item', {})
endfunction

function ddu#ui#get_items(name=get(b:, 'ddu_ui_name', '')) abort
  call ddu#ui_sync_action(a:name, 'getItems', {})
  return b:->get('ddu_ui_items', {})
endfunction

function ddu#ui#get_selected_items(name=get(b:, 'ddu_ui_name', '')) abort
  call ddu#ui_sync_action(a:name, 'getSelectedItems', {})
  return b:->get('ddu_ui_selected_items', [])
endfunction

function ddu#ui#visible(
      \ name=get(b:, 'ddu_ui_name', ''), tabnr = tabpagenr()) abort
  return ddu#_request('uiVisible', [a:name, a:tabnr])
endfunction

function ddu#ui#winid(name=get(b:, 'ddu_ui_name', '')) abort
  return ddu#_request('uiWinid', [a:name])
endfunction
