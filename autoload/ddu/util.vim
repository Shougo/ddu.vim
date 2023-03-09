let s:is_windows = has('win32') || has('win64')

function! ddu#util#print_error(string, name = 'ddu') abort
  echohl Error
  echomsg printf('[%s] %s', a:name,
        \ a:string->type() ==# v:t_string ? a:string : a:string->string())
  echohl None
endfunction

function! ddu#util#execute_path(command, path) abort
  let dir = s:path2directory(a:path)
  " Auto make directory.
  if dir !~# '^\a\+:' && !(dir->isdirectory())
        \ && ddu#util#input_yesno(
        \       printf('"%s" does not exist. Create?', dir))
    call mkdir(dir, 'p')
  endif

  try
    silent execute a:command s:expand(a:path)->fnameescape()
  catch /^Vim\%((\a\+)\)\=:E325\|^Vim:Interrupt/
    " Ignore swap file error
  catch
    call ddu#util#print_error(v:throwpoint)
    call ddu#util#print_error(v:exception)
  endtry
endfunction

function! ddu#util#input_yesno(message) abort
  let yesno = (a:message .. ' [yes/no]: ')->input()
  while yesno !~? '^\%(y\%[es]\|n\%[o]\)$'
    redraw
    if yesno ==# ''
      echo 'Canceled.'
      break
    endif

    " Retry.
    call ddu#util#print_error('Invalid input.')
    let yesno = (a:message .. ' [yes/no]: ')->input()
  endwhile

  redraw

  return yesno =~? 'y\%[es]'
endfunction

function! s:path2directory(path) abort
  return s:substitute_path_separator(
        \ a:path->isdirectory() ? a:path : a:path->fnamemodify(':p:h'))
endfunction

function! s:substitute_path_separator(path) abort
  return s:is_windows ? a:path->substitute('\\', '/', 'g') : a:path
endfunction

function! s:expand(path) abort
  return s:substitute_path_separator(
        \ (a:path =~# '^\~') ? a:path->fnamemodify(':p') : a:path)
endfunction
