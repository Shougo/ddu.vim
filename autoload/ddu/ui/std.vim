function! ddu#ui#std#do_action(name, ...) abort
  let options = get(a:000, 0, {})
  call ddu#do_action(
        \ b:ddu_ui_name, a:name,
        \ [b:ddu_ui_std_items[line('.') - 1]], options)
endfunction

function! ddu#ui#std#update_buffer(bufnr, items) abort
  call setbufvar(a:bufnr, '&modifiable', 1)

  call setbufline(a:bufnr, 1, a:items)
  call deletebufline(a:bufnr, len(a:items) + 1, '$')

  call setbufvar(a:bufnr, '&modifiable', 0)
  call setbufvar(a:bufnr, '&modified', 0)
endfunction
