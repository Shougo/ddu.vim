let g:ddu#ui#std#_filter_bufnr = -1

function! ddu#ui#std#filter#_open(input) abort
  let ids = win_findbuf(g:ddu#ui#std#_filter_bufnr)
  if !empty(ids)
    call win_gotoid(ids[0])
    call cursor(line('$'), 0)
  else
    silent execute 'split' 'ddu-std-filter'
    let g:ddu#ui#std#_filter_winid = win_getid()
    let g:ddu#ui#std#_filter_bufnr = bufnr('%')

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

  nnoremap <buffer><silent> <Plug>(ddu_std_filter_update)
        \ :<C-u>call <SID>update()<CR>
  inoremap <buffer><silent> <Plug>(ddu_std_filter_update)
        \ <ESC>:call <SID>update()<CR>
  nnoremap <buffer><silent> <Plug>(ddu_std_filter_quit)
        \ :<C-u>call <SID>quit(v:true)<CR>
  inoremap <buffer><silent> <Plug>(ddu_std_filter_quit)
        \ <ESC>:<C-u>call <SID>quit(v:true)<CR>
  inoremap <buffer><silent><expr> <Plug>(ddu_std_filter_backspace)
        \ col('.') == 1 ? "\<ESC>:call \<SID>quit(v:false)\<CR>" : "\<BS>"
  inoremap <buffer><silent> <Plug>(ddu_std_filter_space)
        \ <ESC>:call <SID>update()<CR>a<Space>
  inoremap <buffer><silent> <Plug>(ddu_std_filter_clear_backward)
        \ <ESC>"_d0a<BS>

  nmap <buffer> <CR> <Plug>(ddu_std_filter_update)
  nmap <buffer> q    <Plug>(ddu_std_filter_quit)

  imap <buffer> <CR> <Plug>(ddu_std_filter_update)
  imap <buffer> <BS> <Plug>(ddu_std_filter_backspace)
  imap <buffer> <C-h> <Plug>(ddu_std_filter_backspace)
  imap <buffer> <C-u> <Plug>(ddu_std_filter_clear_backward)
  imap <buffer> <Space> <Plug>(ddu_std_filter_space)

  setfiletype ddu-std-filter
endfunction

function! s:update() abort
  let input = getline('.')

  if &filetype !=# 'ddu-std-filter'
        \ || input ==# g:ddu#ui#std#_filter_prev_input
    return
  endif

  let g:ddu#ui#std#_filter_prev_input = input

  call ddu#narrow(input)
endfunction

function! s:quit(force_quit) abort
  if a:force_quit
    call s:update()
  endif

  if winnr('$') ==# 1
    buffer #
  elseif a:force_quit
    close!
  endif

  if win_id2win(g:ddu#ui#std#_filter_winid) <= 0
    let g:ddu#ui#std#_filter_winid = -1
  endif
endfunction
function! ddu#ui#std#filter#_close_filter_window() abort
  if !exists('g:ddu#ui#std#_filter_winid')
        \ || g:ddu#ui#std#_filter_winid < 0
        \ || win_id2win(g:ddu#ui#std#_filter_winid) <= 0
    return
  endif

  let prev = win_getid()

  call win_gotoid(g:ddu#ui#std#_filter_winid)
  close!

  call win_gotoid(prev)
endfunction
