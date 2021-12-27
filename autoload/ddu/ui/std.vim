function! ddu#ui#std#do_action(name) abort
  call ddu#do_action(a:name, [b:ddu_ui_std_items[line('.') - 1]])
endfunction
