function! ddu#ui#std#do_action(name, ...) abort
  let options = get(a:000, 0, {})
  call ddu#do_action(a:name, [b:ddu_ui_std_items[line('.') - 1]], options)
endfunction
