if exists('g:loaded_ddu')
  finish
endif
let g:loaded_ddu = 1

" For backward compatibility
function s:init() abort
  doautocmd <nomodeline> User DDUReady
  autocmd! User DDUReady
endfunction

augroup ddu_plugin_internal
  autocmd!
  autocmd User DenopsPluginPost:ddu ++once ++nested call s:init()
augroup END
