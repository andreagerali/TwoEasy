; Name shown by Windows in "Open with": set it explicitly instead of relying on the exe's description.
!macro customInstall
  WriteRegStr SHCTX "Software\Classes\Applications\TwoEasy.exe" "FriendlyAppName" "TwoEasy"
!macroend

!macro customUnInstall
  DeleteRegValue SHCTX "Software\Classes\Applications\TwoEasy.exe" "FriendlyAppName"
!macroend
