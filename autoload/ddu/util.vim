const s:is_windows = has('win32') || has('win64')

" Profiling log storage
if !exists('g:ddu#_logs')
  let g:ddu#_logs = {}
endif
if !exists('g:ddu#_logs_max_entries')
  let g:ddu#_logs_max_entries = 200
endif

function ddu#util#print_log(name, entries) abort
  if !has_key(g:ddu#_logs, a:name)
    let g:ddu#_logs[a:name] = []
  endif
  
  " Append new entries
  call extend(g:ddu#_logs[a:name], a:entries)
  
  " Cap the log size to max_entries
  if len(g:ddu#_logs[a:name]) > g:ddu#_logs_max_entries
    let g:ddu#_logs[a:name] = g:ddu#_logs[a:name][-g:ddu#_logs_max_entries:]
  endif
endfunction

function ddu#util#get_logs(name) abort
  return get(g:ddu#_logs, a:name, [])->deepcopy()
endfunction

function ddu#util#clear_logs(name) abort
  if has_key(g:ddu#_logs, a:name)
    let g:ddu#_logs[a:name] = []
  endif
endfunction

function ddu#util#get_all_logs() abort
  return g:ddu#_logs->deepcopy()
endfunction

function ddu#util#print_error(string, name = 'ddu') abort
  echohl Error
  for line in
        \ (a:string->type() ==# v:t_string ? a:string : a:string->string())
        \ ->split("\n")->filter({ _, val -> val != ''})
    echomsg printf('[%s] %s', a:name, line)
  endfor
  echohl None
endfunction

function ddu#util#execute_path(command, path) abort
  const path = a:path->s:expand()

  const dir = path->s:path2directory()
  " Auto make directory.
  if dir !~# '^\a\+:' && !dir->isdirectory()
        \ && ddu#util#input_yesno(
        \       printf('"%s" does not exist. Create?', dir))
    call mkdir(dir, 'p')
  endif

  try
    execute a:command path->fnamemodify(':.')->fnameescape()
  catch /^Vim\%((\a\+)\)\=:E325\|^Vim:Interrupt/
    " Ignore swap file error
  catch
    call ddu#util#print_error(v:throwpoint)
    call ddu#util#print_error(v:exception)
  endtry
endfunction

function ddu#util#input_yesno(message) abort
  let yesno = ''
  while yesno !~? '^\%(y\%[es]\|n\%[o]\)$'
    let yesno = (a:message .. ' [yes/no]: ')->input()
    redraw

    if yesno ==# ''
      break
    endif
  endwhile

  redraw

  return yesno =~? 'y\%[es]'
endfunction

function ddu#util#input_list(message, list) abort
  let ret = ''
  let s:input_completion_list = a:list->copy()
  while a:list->index(ret) < 0
    let ret = a:message->input('', 'custom,ddu#util#_complete_ddu_input')
    redraw

    if ret ==# ''
      break
    endif
  endwhile

  redraw

  return ret
endfunction

function ddu#util#benchmark(msg = '') abort
  if !'g:ddu#_started'->exists()
    return
  endif

  let msg = a:msg
  if msg !=# ''
    let msg ..= ' '
  endif
  const diff = g:ddu#_started->reltime()->reltimefloat()
  call ddu#util#print_error(printf('%s%s: Took %f seconds.',
        \ msg, '<sfile>'->expand(), diff))
endfunction

function ddu#util#_complete_ddu_input(ArgLead, CmdLine, CursorPos) abort
  return s:input_completion_list->copy()->join("\n")
endfunction

function s:path2directory(path) abort
  return (a:path->isdirectory() ? a:path : a:path->fnamemodify(':p:h'))
        \ ->s:substitute_path_separator()
endfunction

function s:substitute_path_separator(path) abort
  return s:is_windows ? a:path->substitute('\\', '/', 'g') : a:path
endfunction

function s:expand(path) abort
  return ((a:path =~# '^\~') ? a:path->fnamemodify(':p') : a:path)
        \ ->s:substitute_path_separator()
endfunction
