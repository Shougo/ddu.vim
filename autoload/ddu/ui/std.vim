function! ddu#ui#std#do_map(name, ...) abort
  call ddu#ui_action(
        \ b:ddu_ui_name, a:name, get(a:000, 0, {}))
endfunction

function! ddu#ui#std#update_buffer(bufnr, items) abort
  call setbufvar(a:bufnr, '&modifiable', 1)

  call setbufline(a:bufnr, 1, map(a:items,
        \ { _, val -> printf(' %s', val) }))
  call deletebufline(a:bufnr, len(a:items) + 1, '$')

  call setbufvar(a:bufnr, '&modifiable', 0)
  call setbufvar(a:bufnr, '&modified', 0)
endfunction
