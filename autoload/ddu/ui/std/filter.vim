let g:ddu#ui#std#_filter_name = ''

function! ddu#ui#std#filter#_open(name, input, bufnr) abort
  let ids = win_findbuf(a:bufnr)
  if !empty(ids)
    call win_gotoid(ids[0])
    call cursor(line('$'), 0)
  else
    silent execute 'split' 'ddu-std-filter'
    let g:ddu#ui#std#_filter_winid = win_getid()

    call s:init_buffer()

    " Set the current input
    if getline('$') ==# ''
      call setline('$', a:input)
    else
      call append('$', a:input)
    endif
  endif

  augroup ddu-std-filter
    autocmd!
    autocmd InsertEnter,TextChangedI,TextChangedP,TextChanged,InsertLeave
          \ <buffer> call s:update()
  augroup END

  call cursor(line('$'), 0)
  startinsert!

  let g:ddu#ui#std#_filter_prev_input = getline('.')
  let g:ddu#ui#std#_filter_name = a:name
  return bufnr('%')
endfunction

function! s:init_buffer() abort
  setlocal bufhidden=hide
  setlocal buftype=nofile
  setlocal colorcolumn=
  setlocal foldcolumn=0
  setlocal nobuflisted
  setlocal nofoldenable
  setlocal nolist
  setlocal nomodeline
  setlocal nonumber
  setlocal norelativenumber
  setlocal nospell
  setlocal noswapfile
  setlocal nowrap
  setlocal signcolumn=auto
  setlocal winfixheight

  resize 1

  setfiletype ddu-std-filter
endfunction

function! s:update() abort
  let input = getline('.')

  if &filetype !=# 'ddu-std-filter'
        \ || input ==# g:ddu#ui#std#_filter_prev_input
    return
  endif

  let g:ddu#ui#std#_filter_prev_input = input

  call ddu#narrow(g:ddu#ui#std#_filter_name, input)
endfunction
