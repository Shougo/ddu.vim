"=============================================================================
" FILE: util.vim
" AUTHOR: Shougo Matsushita <Shougo.Matsu at gmail.com>
" License: MIT license
"=============================================================================

let s:is_windows = has('win32') || has('win64')

function! ddu#util#print_error(string, ...) abort
  let name = a:0 ? a:1 : 'ddu'
  echohl Error
  echomsg printf('[%s] %s', name,
        \ type(a:string) ==# v:t_string ? a:string : string(a:string))
  echohl None
endfunction

function! ddu#util#execute_path(command, path) abort
  let dir = ddu#util#path2directory(a:path)
  " Auto make directory.
  if dir !~# '^\a\+:' && !isdirectory(dir)
        \ && ddu#util#input_yesno(
        \       printf('"%s" does not exist. Create?', dir))
    call mkdir(dir, 'p')
  endif

  try
    execute a:command fnameescape(s:expand(a:path))
  catch /^Vim\%((\a\+)\)\=:E325\|^Vim:Interrupt/
    " Ignore swap file error
  catch
    call ddu#util#print_error(v:throwpoint)
    call ddu#util#print_error(v:exception)
  endtry
endfunction

function! ddu#util#input_yesno(message) abort
  let yesno = input(a:message . ' [yes/no]: ')
  while yesno !~? '^\%(y\%[es]\|n\%[o]\)$'
    redraw
    if yesno ==# ''
      echo 'Canceled.'
      break
    endif

    " Retry.
    call ddu#util#print_error('Invalid input.')
    let yesno = input(a:message . ' [yes/no]: ')
  endwhile

  redraw

  return yesno =~? 'y\%[es]'
endfunction

function! ddu#util#substitute_path_separator(path) abort
  return s:is_windows ? substitute(a:path, '\\', '/', 'g') : a:path
endfunction
function! ddu#util#path2directory(path) abort
  return ddu#util#substitute_path_separator(
        \ isdirectory(a:path) ? a:path : fnamemodify(a:path, ':p:h'))
endfunction

function! s:expand(path) abort
  return ddu#util#substitute_path_separator(
        \ (a:path =~# '^\~') ? fnamemodify(a:path, ':p') :
        \ a:path)
endfunction
