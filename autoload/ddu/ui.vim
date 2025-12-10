function ddu#ui#async_action(
      \ action_name, params = {}, ui_name=b:->get('ddu_ui_name', '')) abort
  call ddu#ui_async_action(a:ui_name, a:action_name, a:params)
endfunction

function ddu#ui#sync_action(
      \ action_name, params = {}, ui_name=b:->get('ddu_ui_name', '')) abort
  call ddu#ui_sync_action(a:ui_name, a:action_name, a:params)
endfunction

function ddu#ui#do_action(
      \ action_name, params = {}, ui_name=b:->get('ddu_ui_name', '')) abort
  return ddu#ui#sync_action(a:action_name, a:params, a:ui_name)
endfunction

function ddu#ui#multi_actions(
      \ actions, ui_name=b:->get('ddu_ui_name', '')) abort
  for action in a:actions
    call call('ddu#ui_sync_action',
          \ [a:ui_name] + (type(action) == v:t_list ? action : [action]))
  endfor
endfunction

function ddu#ui#get_item(name=b:->get('ddu_ui_name', '')) abort
  return b:->get('ddu_ui_item', {})
endfunction

function ddu#ui#get_items(name=b:->get('ddu_ui_name', '')) abort
  return b:->get('ddu_ui_items', [])
endfunction

function ddu#ui#get_selected_items(name=b:->get('ddu_ui_name', '')) abort
  return b:->get('ddu_ui_selected_items', [])->empty()
        \ ? [ddu#ui#get_item(a:name)]
        \ : b:->get('ddu_ui_selected_items', [])
endfunction

function ddu#ui#visible(
      \ name=b:->get('ddu_ui_name', ''), tabnr = tabpagenr()) abort
  return ddu#denops#_running() ?
        \ ddu#denops#_request('uiVisible', [a:name, a:tabnr]) : v:false
endfunction

function ddu#ui#winids(name=b:->get('ddu_ui_name', '')) abort
  return ddu#denops#_running() ?
        \ ddu#denops#_request('uiWinids', [a:name]) : []
endfunction

function ddu#ui#update_cursor(name=b:->get('ddu_ui_name', '')) abort
  return ddu#denops#_running() ?
        \ ddu#denops#_request('uiUpdateCursor', [a:name]) : []
endfunction

function ddu#ui#_open_filter_window(
      \ options, input, name, length, history) abort
  let s:filter_prev_input = a:input
  let s:filter_init_input = a:input
  let s:filter_history = a:history
  let s:filter_update_callback = a:options.filterUpdateCallback

  let b:ddu_ui_name = a:name
  " Reset saved item when filtering.
  let b:ddu_ui_item = {}

  augroup ddu-filter
    autocmd!
  augroup END

  if a:options.filterUpdateMax <= 0 || a:length <= a:options.filterUpdateMax
    autocmd ddu-filter CmdlineChanged * ++nested
          \ call s:update_input(getcmdline(), s:filter_update_callback)
  endif

  doautocmd User Ddu:uiOpenFilterWindow

  " NOTE: redraw is needed
  redraw

  let opts = #{
        \   prompt: a:options.filterPrompt,
        \   default: a:input,
        \   completion: 'custom,ddu#ui#_complete_input',
        \   cancelreturn: a:input,
        \ }

  let new_input = has('nvim') && a:options.filterInputOptsFunc !=# ''
        \ ? a:options.filterInputOptsFunc->call([opts])
        \ : a:options.filterInputFunc->call(
        \    [opts.prompt, opts.default, opts.completion])

  doautocmd User Ddu:uiCloseFilterWindow

  augroup ddu-filter
    autocmd!
  augroup END

  let new_input = s:update_input(new_input, a:options.filterUpdateCallback)

  return new_input
endfunction

function ddu#ui#_complete_input(arglead, cmdline, cursorpos) abort
  return s:filter_history->join("\n")
endfunction

function ddu#ui#save_cmaps(keys) abort
  let s:save_maps = {}
  for key in a:keys
    let s:save_maps[key] = key->maparg('c', v:false, v:true)
  endfor
endfunction

function ddu#ui#restore_cmaps() abort
  if !'s:save_maps'->exists()
    return
  endif

  for [key, map] in s:save_maps->items()
    " Remove current map
    let ff_map = key->maparg('c', v:false, v:true)
    if !ff_map->empty()
      if ff_map.buffer
        execute 'cunmap' '<buffer>' key
      else
        execute 'cunmap' key
      endif
    endif

    if !map->empty()
      " Restore old map
      call mapset('c', 0, map)
    endif
  endfor

  let s:save_maps = {}
endfunction

function s:update_input(input, callback) abort
  let input = a:input
  if a:callback !=# ''
    let input = a:callback->call([input])
  endif

  const ui_name = b:->get('ddu_ui_name', t:->get('ddu_ui_name', ''))
  if input ==# s:filter_prev_input || ui_name ==# ''
    return input
  endif

  let s:filter_prev_input = input

  call ddu#redraw(ui_name, #{ input: input })

  return input
endfunction
