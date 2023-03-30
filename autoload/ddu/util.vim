const s:is_windows = has('win32') || has('win64')

function! ddu#util#print_error(string, name = 'ddu') abort
  echohl Error
  echomsg printf('[%s] %s', a:name,
        \ a:string->type() ==# v:t_string ? a:string : a:string->string())
  echohl None
endfunction

function! ddu#util#execute_path(command, path) abort
  const path = s:expand(a:path)

  const dir = s:path2directory(path)
  " Auto make directory.
  if dir !~# '^\a\+:' && !(dir->isdirectory())
        \ && ddu#util#input_yesno(
        \       printf('"%s" does not exist. Create?', dir))
    call mkdir(dir, 'p')
  endif

  try
    silent execute a:command path->fnamemodify(':.')->fnameescape()
  catch /^Vim\%((\a\+)\)\=:E325\|^Vim:Interrupt/
    " Ignore swap file error
  catch
    call ddu#util#print_error(v:throwpoint)
    call ddu#util#print_error(v:exception)
  endtry
endfunction

function! ddu#util#input_yesno(message) abort
  let yesno = ''
  while yesno !~? '^\%(y\%[es]\|n\%[o]\)$'
    let yesno = (a:message .. ' [yes/no]: ')->input()
    redraw
    if yesno ==# ''
      echo 'Canceled.'
      break
    endif

    " Retry.
    call ddu#util#print_error('Invalid input.')
  endwhile

  redraw

  return yesno =~? 'y\%[es]'
endfunction

function! ddu#util#input_list(message, list) abort
  let ret = ''
  let s:input_completion_list = copy(a:list)
  while a:list->index(ret) < 0
    let ret = (a:message)->input('', 'customlist,CompleteDduInput')
    redraw
    if ret ==# ''
      echo 'Canceled.'
      break
    endif

    " Retry.
    call ddu#util#print_error('Invalid input.')
  endwhile

  redraw

  return ret
endfunction

function CompleteDduInput(ArgLead, CmdLine, CursorPos) abort
  return s:input_completion_list->copy()->filter(
        \ { _, val -> val->stridx(a:ArgLead) == 0 })
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
