# Local Firebase build configuration

Create `firebase.json` here using the four real Firebase Android identifiers
listed in the main README. This file is ignored by Git. Do not put service-account
credentials or administrator passwords here. Then build with:

```powershell
flutter build apk --debug --dart-define-from-file=config/firebase.json
```
