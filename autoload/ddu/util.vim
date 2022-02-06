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
    silent execute a:command fnameescape(s:expand(a:path))
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

function! s:check_wsl() abort
  if has('nvim')
    return has('wsl')
  endif
  if has('unix') && executable('uname')
    return match(system('uname -r'), "\\cMicrosoft") >= 0
  endif
  return v:false
endfunction

function! ddu#util#open(filename) abort
  let filename = fnamemodify(a:filename, ':p')

  let is_cygwin = has('win32unix')
  let is_mac = !s:is_windows && !is_cygwin
        \ && (has('mac') || has('macunix') || has('gui_macvim') ||
        \   (!isdirectory('/proc') && executable('sw_vers')))
  let is_wsl = s:check_wsl()

  " Detect desktop environment.
  if s:is_windows
    " For URI only.
    " Note:
    "   # and % required to be escaped (:help cmdline-special)
    silent execute printf(
          \ '!start rundll32 url.dll,FileProtocolHandler %s',
          \ escape(filename, '#%'),
          \)
  elseif is_cygwin
    " Cygwin.
    call system(printf('%s %s', 'cygstart',
          \ shellescape(filename)))
  elseif executable('xdg-open')
    " Linux.
    call system(printf('%s %s &', 'xdg-open',
          \ shellescape(filename)))
  elseif executable('lemonade')
    call system(printf('%s %s &', 'lemonade open',
          \ shellescape(filename)))
  elseif exists('$KDE_FULL_SESSION') && $KDE_FULL_SESSION ==# 'true'
    " KDE.
    call system(printf('%s %s &', 'kioclient exec',
          \ shellescape(filename)))
  elseif exists('$GNOME_DESKTOP_SESSION_ID')
    " GNOME.
    call system(printf('%s %s &', 'gnome-open',
          \ shellescape(filename)))
  elseif executable('exo-open')
    " Xfce.
    call system(printf('%s %s &', 'exo-open',
          \ shellescape(filename)))
  elseif is_mac && executable('open')
    " Mac OS.
    call system(printf('%s %s &', 'open',
          \ shellescape(filename)))
  elseif is_wsl && executable('cmd.exe')
    " WSL and not installed any open commands

    " Open the same way as Windows.
    " I don't know why, but the method using execute requires redraw <C-l>
    " after execution in vim.
    call system(printf('cmd.exe /c start rundll32 %s %s',
          \ 'url.dll,FileProtocolHandler',
          \ escape(filename, '#%')))
  else
    " Give up.
    throw 'Not supported.'
  endif
endfunction
