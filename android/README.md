# 안드로이드 앱 (APK)

배포 사이트(https://hwangyj2366-code.github.io/Weekend-outing/)를 감싼 앱이에요(Trusted Web Activity, Bubblewrap으로 만듦).
앱 안 화면은 사이트 그대로라, 사이트를 고치면 앱도 바로 바뀌어요. APK를 다시 만들 일은 아이콘·이름·패키지 설정을 바꿀 때뿐이에요.

- 패키지: `io.github.hwangyj2366code.weekend`
- 설정: `twa-manifest.json` (바꾼 뒤 `npx @bubblewrap/cli update --skipVersionUpgrade`로 프로젝트 다시 만들기)
- 서명 키: `weekend.keystore` + 비밀번호 `keystore.local.json` — **git에 올리지 않아요. 꼭 따로 백업하세요.** 키를 잃으면 같은 앱으로 업데이트할 수 없어요.
- 키 지문(SHA-256)은 `hwangyj2366-code.github.io` 저장소의 `.well-known/assetlinks.json`에 있어요. 이게 맞아야 앱 위쪽 주소창이 사라져요.

## 다시 만들기 (Windows, Git Bash)

```bash
cd android
echo 'sdk.dir=C:/Users/nayan/AppData/Local/Android/Sdk' > local.properties
export JAVA_HOME="C:/Users/nayan/.bubblewrap/jdkdl/jdk-17.0.21+9"   # JDK 17 (Gradle 8.11은 JDK 25에서 안 돼요)
./gradlew.bat assembleRelease
BT="C:/Users/nayan/AppData/Local/Android/Sdk/build-tools/36.0.0"
"$BT/zipalign.exe" -p -f 4 app/build/outputs/apk/release/app-release-unsigned.apk aligned.apk
export PW=$(node -e "console.log(require('./keystore.local.json').password)")
"$BT/apksigner.bat" sign --ks weekend.keystore --ks-key-alias weekend --ks-pass env:PW --key-pass env:PW --out weekend-outing-1.0.0.apk aligned.apk
```

버전을 올릴 때는 `twa-manifest.json`과 `app/build.gradle`의 `appVersionCode`(숫자)를 1씩 올려요.
