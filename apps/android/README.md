# App Android (APK)

Trusted Web Activity (TWA): o app abre `https://paytracking.com.br` em tela cheia, sem barra de endereço.
O conteúdo vem do site, então cada deploy já aparece no app sem gerar APK novo.
Só é preciso um APK novo para mudar ícone, nome, cores ou a URL (aumente `versionCode`/`versionName` em `app/build.gradle`).

- Pacote: `br.com.paytracking.app`
- Download publicado: `apps/web/public/download/paytracking.apk` → `https://paytracking.com.br/download/paytracking.apk`
- Tela cheia depende de `/.well-known/assetlinks.json` (servidor), que usa `ANDROID_APP_PACKAGE` e `ANDROID_CERT_SHA256`.

## Gerar o APK

Requisitos: JDK 17+ e Android SDK (platform 36, build-tools 36).

```bash
export ANDROID_HOME=/caminho/android-sdk
export PT_KEYSTORE=/caminho/seguro/paytracking-release.jks
export PT_KEYSTORE_PASSWORD='...'
./gradlew assembleRelease
cp app/build/outputs/apk/release/app-release.apk ../web/public/download/paytracking.apk
```

A chave (`.jks`) e a senha **nunca** vão para o repositório. Guarde-as em local seguro:
sem a mesma chave, o Android não aceita atualizar o app já instalado (seria preciso desinstalar e instalar de novo),
e o `assetlinks.json` deixa de reconhecer o app (volta a aparecer a barra de endereço).
