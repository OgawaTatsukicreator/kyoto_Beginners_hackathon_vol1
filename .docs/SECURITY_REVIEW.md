# KYOTABI＋ セキュリティ検証結果

検証日：2026年10月26日（日本時間）

対象：`kyoto_Beginners_hackathon_vol1`

基準コミット：`c8c877ccff515596f3b81bdb5de6d290295900e8`

実行環境：Windows、Node.js 20.19.1、npm 10.8.2

## 結果の要約

優先して修正すべき問題は3件です。位置共有をOFFにしても元のGPS座標を投稿へ含める処理、有効なGoogleキーの設定時に匿名利用者が有料APIを反復実行できる処理、削除用の秘密情報を保存できなくても投稿を公開する処理を、外部通信なしのローカル実験で確認しました。

依存監査では4パッケージに警告があり、集約された重大度は **Critical 1件、High 3件** でした。この件数は影響を受ける依存パッケージ数です。Next.jsとsharpの警告には同じCVEが含まれます。現在のコードと既定設定では各攻撃の前提を確認できないため、このアプリでCriticalの攻撃が成立するとは判定していません。

Supabaseの権限設定と公開環境は今回のローカル資料から検証できません。とくに、RLSで投稿の変更・削除やサイズ上限を守るというコードコメントは、SQL定義や権限試験で裏付けられていません。**プロジェクト全体の安全性については判定保留**とします。

| ID | 判定 | 重大度 | 内容 | 検証状況 |
|---|---|---|---|---|
| SEC-01 | [must] | High | 位置共有OFFでも元のGPSを送信 | 実コードを使ったモック実行で再現 |
| SEC-02 | [must] | High・条件付き | 匿名リクエストで有料Google APIを反復実行 | ローカルの処理回数を再現。キーと配信側制限は未確認 |
| SEC-03 | [must] | Medium | 削除手段を保存できずに公開成功 | 保存失敗と暗号機能失敗を再現。DB受理は模擬 |
| SEC-04 | [recommend] | 監査値 Critical / High | 既知の脆弱版を含む依存解決 | lockfileと公式アドバイザリを照合。攻撃成立は未確認 |
| SEC-05 | [recommend] | Low・現行用途 | ポイントによる非表示を回避可能 | 本文と場所の配信、未解放画面のソースを確認 |
| SEC-06 | [recommend] | Low | 座標の欠落、空白、範囲外を上流へ転送 | ローカルで再現 |
| SEC-07 | [recommend] | Low・開発作業 | 選別用CSVに数式の開始文字を残す | 実エンコーダーを無害な入力で確認 |

`[must]` は今回確認した公開データや運用資源への具体的な問題、`[recommend]` は条件付きのリスクや防御強化です。重大度は影響、確度は根拠の強さを表します。

## 検証範囲と方法

現行READMEを基準に、`app/`、`components/`、`lib/`、`scripts/`、設定、lockfile、公開写真を確認しました。適用される `AGENTS.md` 等は見つかりませんでした。`.docx/` の資料は現行実装と相違があるため、過去の参考資料として扱いました。

API、クライアント、依存関係を独立したレビューに分け、主担当がコード、実験、一次資料と照合して指摘を再評価しました。検証には `security-best-practices` と `review` の手順を使っています。

- 実コードを読み込み、TypeScriptの型注釈等を取り除いてNode.jsのVMで実行。外部通信、ブラウザ保存、画面の状態更新をモックへ置き換えました。
- npm公式監査サービスで `npm audit --ignore-scripts --json` を実行。取得した警告を開発元のアドバイザリと照合しました。
- ローカルの全到達可能Git履歴2コミットから重複を除いたテキスト56 blobを、秘密情報の値を出力せずパターン検査しました。
- 同梱JPEG写真12枚のEXIFを既存診断スクリプトで確認しました。

公開デモや外部DBへのアクセス試験、実際の投稿・削除、実キーを使うGoogle呼び出し、負荷試験は行っていません。アプリ本体、依存宣言、lockfileの変更もありません。

## 優先修正項目

### SEC-01 [must] 位置共有の無効設定と送信内容の不一致

**重大度：High／確度：高。** 利用者が位置共有をOFFにして写真を投稿しても、アプリは取得済みの正確なGPS座標を共有DBへ送る処理を実行します。

**根拠となるコード**

- [設定画面 95行](<C:/Users/小川樹/Pictures/Saved Pictures/OneDrive/ドキュメント/my AI/kyoto_Beginners_hackathon_vol1/app/settings/page.tsx:95>)：「投稿に位置情報を含める」を `sharePlace` に保存。
- [投稿画面 132行](<C:/Users/小川樹/Pictures/Saved Pictures/OneDrive/ドキュメント/my AI/kyoto_Beginners_hackathon_vol1/app/new/page.tsx:132>)：写真選択時にEXIFを読み、座標があれば場所を自動照会。
- [投稿画面 163行](<C:/Users/小川樹/Pictures/Saved Pictures/OneDrive/ドキュメント/my AI/kyoto_Beginners_hackathon_vol1/app/new/page.tsx:163>)：場所欄が空でもGPS文字列で補完。173〜174行で元の `geo.lat/lng` を送信。
- [共有投稿処理 246行](<C:/Users/小川樹/Pictures/Saved Pictures/OneDrive/ドキュメント/my AI/kyoto_Beginners_hackathon_vol1/lib/remotePosts.ts:246>)：座標をDB行へ格納するPOSTを構成。投稿画面は `getSettings()` を参照していません。

**再現結果**：`sharePlace=false` と合成GPSを与えて投稿処理を実行すると、設定読取は0回で、元の座標を全桁送信しました。場所を広域名へ変更しても座標は残り、場所欄を空にすると座標の文字列が復活します。記録は `client-checks.json` の `opt-out-*` 2項目。

**影響と成立条件**：写真にGPSがあるか、現在地を取得し、共有DBが投稿を受理する場合。自宅等の撮影地点を含む写真では、利用者の非共有設定に反して場所を公開し得ます。匿名の投稿取得も `select=*` で座標を受け取る実装です。実DBでの公開範囲は未確認です。

**最小修正方針**：写真選択、地名照会、最終送信の各段階で設定を適用します。OFF時は自動取得した場所と `mapQuery/lat/lng` を送らず、場所欄を空にしてもGPSで復元しないこと。手入力の場所を別途公開する場合は、その範囲を利用者に明示します。修正後はGPS付き写真、手動修正、空欄、設定切替の各場合に送信内容を検証してください。

### SEC-02 [must] 有料APIの匿名反復実行

**重大度：High（公開・有効キー・外部制限なしの場合）／確度：アプリ内の制限欠如は高、公開環境の成立条件は未確認。** 第三者がキーを知らずに運営者のAPI利用枠や費用を消費できます。

**根拠**：[逆ジオコーディングAPI 10行](<C:/Users/小川樹/Pictures/Saved Pictures/OneDrive/ドキュメント/my AI/kyoto_Beginners_hackathon_vol1/app/api/reverse-geocode/route.ts:10>)から、利用者の確認や回数制限を経ず、24行でPlaces、必要に応じて60行でGeocodingを呼び出します。6秒のタイムアウトは呼び出し回数を制限しません。

**再現結果**：同じ匿名GET相当の処理を5回実行すると、上流呼び出しは10回。キー未設定の対照は204、上流0回でした。`api-checks.json` に両方を記録しています。Next.js 15のGET Route Handlerは[既定ではキャッシュされません](https://nextjs.org/docs/15/app/getting-started/route-handlers-and-middleware)。

**最小修正方針**：匿名利用を続ける場合も、入口に分散環境で共有できる回数制限と全体利用上限を設け、上限超過時はGoogleを呼ぶ前に429等を返します。Google側のクォータも設定し、必要に応じて座標を適切な粒度でキャッシュしてください。CORS制限だけではAPIへの直接アクセスを防げません。[Googleの費用管理資料](https://developers.google.com/maps/billing-and-pricing/manage-costs)

また、[32行のFieldMask](<C:/Users/小川樹/Pictures/Saved Pictures/OneDrive/ドキュメント/my AI/kyoto_Beginners_hackathon_vol1/app/api/reverse-geocode/route.ts:32>)にある未使用の `places.userRatingCount` は削除候補です。Googleはこの項目を[Nearby Search Enterpriseの対象](https://developers.google.com/maps/documentation/places/web-service/nearby-search)としています。

**留保**：実際の請求額、有効キーの有無、Googleのキー制限、WAF等の設定は調べていません。実験が示すのはアプリの処理回数です。

### SEC-03 [must] 削除権の保存失敗後も公開成功を返す処理

**重大度：Medium／確度：高。** ブラウザへの保存に失敗すると、投稿者はアプリが提供する削除手段を使えなくなります。

**根拠**：[共有投稿処理 217行](<C:/Users/小川樹/Pictures/Saved Pictures/OneDrive/ドキュメント/my AI/kyoto_Beginners_hackathon_vol1/lib/remotePosts.ts:217>)はトークン生成失敗を許容し、264〜266行は共有POSTの成功後に所有IDと削除トークンを保存してから成功を返します。[82行の `writeTokens`](<C:/Users/小川樹/Pictures/Saved Pictures/OneDrive/ドキュメント/my AI/kyoto_Beginners_hackathon_vol1/lib/remotePosts.ts:82>)は保存失敗を呼び出し元へ伝えません。削除は277行でローカルのトークンを必須とします。

**再現結果**：DBのPOST成功を模擬し、`localStorage.setItem` に容量不足相当の例外を発生させると、`ok:true`、`canDeletePost:false`、保存トークンなしとなりました。正常系は削除可能です。暗号機能失敗時も同様の結果でした。`client-checks.json` の `post-deletion-capability-*` 3項目に記録。

**影響と成立条件**：保存が拒否・失敗し、共有DBは投稿を受理する場合。写真や位置を公開した後、自分で取り消せません。暗号機能失敗時のNULLハッシュ受理はDB側次第ですが、通常のハッシュを送った後のローカル保存失敗はDBから判別できません。

**最小修正方針**：公開前に削除トークンと所有IDを生成・永続化し、再読取で保存を確かめます。確保できなければ投稿を止め、公開前のエラーとして案内してください。公開後の紛失には別途回復・削除手段が必要です。

## 推奨対応

### SEC-04 [recommend] 脆弱版を含む依存関係

**重大度：監査値Critical / High／確度：版の一致は高、現行アプリでの攻撃成立は未確認。**

| パッケージ | lockfileの根拠 | 監査値 | 修正版の目安 | このアプリでの評価 |
|---|---|---|---|---|
| next 15.5.24 | [829行](<C:/Users/小川樹/Pictures/Saved Pictures/OneDrive/ドキュメント/my AI/kyoto_Beginners_hackathon_vol1/package-lock.json:829>) | Critical | 15.5.28以上 | SVG処理、Server Actions、特定のキャッシュ構成が条件。下記参照 |
| sharp 0.35.4 | [955行](<C:/Users/小川樹/Pictures/Saved Pictures/OneDrive/ドキュメント/my AI/kyoto_Beginners_hackathon_vol1/package-lock.json:955>) | High | 0.35.5以上 | Nextの画像警告と同じCVE。optional dependency |
| postcss 8.4.31 | [887行](<C:/Users/小川樹/Pictures/Saved Pictures/OneDrive/ドキュメント/my AI/kyoto_Beginners_hackathon_vol1/package-lock.json:887>) | High | 8.5.23以上 | 利用者CSSを処理する経路を確認できず |
| source-map-js 1.2.1 | [1005行](<C:/Users/小川樹/Pictures/Saved Pictures/OneDrive/ドキュメント/my AI/kyoto_Beginners_hackathon_vol1/package-lock.json:1005>) | High | 1.2.2以上 | 利用者ソースマップを処理する経路を確認できず |

**条件の照合**

- [Nextの画像RCE](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw)と[sharpの警告](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w)は同じ `CVE-2026-96889`。不正SVGを処理する経路とglibc Linux等の条件が必要です。現行の `next.config.mjs` は空設定で、[同じNext版の既定値](https://raw.githubusercontent.com/vercel/next.js/v15.5.24/packages/next/src/shared/lib/image-config.ts)はSVGや外部画像を許可していません。[画像処理実装](https://raw.githubusercontent.com/vercel/next.js/v15.5.24/packages/next/src/server/image-optimizer.ts)にもSVG拒否があります。アプリは通常の `img` を使い、投稿画像はブラウザでJPEG化しています。`next/image` 未使用だけを理由に最適化エンドポイントが無効だとは判断していません。
- [Server ActionsのDoS](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r)は少なくとも1つのServer Actionが条件。現行ソースに該当処理はありません。
- キャッシュ汚染の警告は[自前配信のPages RouterでのSSG/ISR](https://github.com/vercel/next.js/security/advisories/GHSA-4jqv-mc3x-m676)、または[ルートcatch-allとSSG/ISR](https://github.com/vercel/next.js/security/advisories/GHSA-mcj8-r9mp-w47p)が条件。現行はApp Routerで、ルートcatch-allもありません。
- PostCSSには[XSS](https://github.com/postcss/postcss/security/advisories/GHSA-qx2v-qp2m-jg93)、[ファイル読取](https://github.com/postcss/postcss/security/advisories/GHSA-6g55-p6wh-862q)、[mapパストラバーサル](https://github.com/postcss/postcss/security/advisories/GHSA-r28c-9q8g-f849)、[不完全修正](https://github.com/postcss/postcss/security/advisories/GHSA-fxqj-rqcc-2cmp)の警告があります。処理するCSSや結果の公開方法に条件があります。source-map-jsの[修正リリース](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2)も確認しました。

**対応方針**：互換性を確認して各修正版を解決し、lockfileを更新して再監査・ビルドを実施してください。Next 15.5.28も[PostCSSを8.4.31に固定](https://raw.githubusercontent.com/vercel/next.js/v15.5.28/packages/next/package.json)しているため、Nextだけ更新して全件解消するとは限りません。互換性を検証した依存上書き、または修正版を含む上流版が別途必要です。ここでの版は2026年10月26日の確認結果です。

### SEC-05 [recommend] ポイントと本文・場所の閲覧制限

**重大度：Low（現行の無料デモ用途）／確度：高。**

**根拠**：[投稿一覧取得 167行](<C:/Users/小川樹/Pictures/Saved Pictures/OneDrive/ドキュメント/my AI/kyoto_Beginners_hackathon_vol1/lib/remotePosts.ts:167>)と詳細取得は `select=*` で本文、場所、座標を取得します。[未解放表示 211行](<C:/Users/小川樹/Pictures/Saved Pictures/OneDrive/ドキュメント/my AI/kyoto_Beginners_hackathon_vol1/app/post/[id]/page.tsx:211>)も本文全文を描画し、CSSで途中を隠しています。[ポイント処理 44行](<C:/Users/小川樹/Pictures/Saved Pictures/OneDrive/ドキュメント/my AI/kyoto_Beginners_hackathon_vol1/lib/points.ts:44>)の残高と解放状態はローカルで変更可能です。種データも配信コードに含まれます。

**検証**：モック行を実際の取得・変換関数へ渡し、解放前にも全文、場所、GPSが返ることを確認。画面についてはソースの確認で、ブラウザ描画試験は未実施です。

**対応方針**：現行READMEはログインなし・ブラウザ保存と明記しているため、不正課金や金銭被害とは評価しません。内容の秘匿やポイントの価値を保証する用途へ進める場合、一覧には要約だけを返し、本文・場所はサーバー側で閲覧権を確認して取得する設計が必要です。現行用途では、非表示を秘密情報の保護として説明しないでください。

### SEC-06 [recommend] 座標の入力検証

**重大度：Low／確度：高。**

**根拠**：[逆ジオコーディングAPI 11行](<C:/Users/小川樹/Pictures/Saved Pictures/OneDrive/ドキュメント/my AI/kyoto_Beginners_hackathon_vol1/app/api/reverse-geocode/route.ts:11>)の `Number()` と有限数確認のみ。欠落や空白は0となり、`91/181`、`-91/-181`、`1e300/1e300` も上流へ届きました。

**影響**：無効な問い合わせを早期に拒否できず、余分な処理や座標ゼロ地点の誤表示につながります。SEC-02の回数制限の代わりにはなりません。

**修正方針**：生の両パラメーターが存在し、空白でないことを確認してから数値化。緯度は `[-90,90]`、経度は `[-180,180]` に制限し、不正なら上流通信前に400を返します。Googleによる範囲外入力の受理・課金は未検証です。

### SEC-07 [recommend] 選別用CSVの数式対策

**重大度：Low（開発者がCSVを開く作業）／確度：数式文字の残存は高、実Excelでの実行は未確認。**

**根拠**：[CSV生成 91行](<C:/Users/小川樹/Pictures/Saved Pictures/OneDrive/ドキュメント/my AI/kyoto_Beginners_hackathon_vol1/scripts/curate-spots.mjs:91>)は外部取得した店名等の二重引用符をエスケープしますが、数式の開始文字は処理しません。既存作業資料はExcelで開く手順です。

**検証**：実エンコーダーに無害な `=1+1` を与えると `"=1+1"` になり、先頭の `=` が残りました。結果は `csv-checks.json`。Google上の掲載情報を攻撃者が操作でき、その値が収集・選別を通ってCSVへ入り、開発者が表計算ソフトで開く場合の条件付きリスクです。現在のデータに攻撃式があるとは判定していません。[OWASP CSV Injection](https://owasp.org/www-community/attacks/CSV_Injection)

**修正方針**：人が閲覧する表はセルを文字列型に指定できる形式にするか、対象ソフトで式として解釈されない書き出し方を採用します。二重引用符で囲むだけでは式を無効にできません。対策は再保存・再読込後も確認してください。

## 反証を試みたが壊せなかった点

- 投稿本文やタイトルは通常のJSXで表示し、対象ソースに `dangerouslySetInnerHTML`、`innerHTML`、`eval`、`new Function` の利用は見つかりませんでした。保存型XSSが成立する経路は確認できません。
- Googleマップへのリンクは固定のHTTPS宛先を使います。地名等の文字列クエリはURLエンコードし、座標リンクは数値から構成。別タブには `noopener noreferrer` を指定しています。
- 逆ジオコーディングの上流宛先は固定のGoogleホストです。非数値、Infinity、URL、クエリ挿入文字列は400・上流0回となりました。SSRFやクエリ挿入は確認できません。
- Googleキーはサーバー側環境変数から取得しています。ダミーキーを使った18項目の応答にキーは出ませんでした。キー未設定時は204、上流通信なし。
- 通常系の削除用トークンは `crypto.getRandomValues` で128bit生成し、クライアントはSHA-256ハッシュだけを投稿時に送ります。ただしDBでの照合実装は未確認です。
- 履歴2コミット・重複を除いたテキスト56 blobのGoogle/AWS/GitHub/Stripe/Supabase secret、秘密鍵、JWT、認証情報付きURLのパターン検査で一致0。追跡 `.env*` と作業ツリー直下の `.env*` もありません。任意形式の秘密情報や未取得の履歴まで否定する検査ではありません。実行条件と件数は `secret-scan-summary.json` に記録しています。
- [共有投稿処理 20行](<C:/Users/小川樹/Pictures/Saved Pictures/OneDrive/ドキュメント/my AI/kyoto_Beginners_hackathon_vol1/lib/remotePosts.ts:20>)のキーは公開前提のSupabase publishable key。秘密鍵の漏えいに数えていません。データ保護は権限設定に依存します。[Supabase公式資料](https://supabase.com/docs/guides/getting-started/api-keys)
- 同梱JPEG12枚にEXIFセグメントはありませんでした。通常の投稿経路もcanvasでJPEGを再生成します。ただし、再生成前に取り出したGPSを別フィールドで送るSEC-01は残ります。

## 前提・未確認事項

| 項目 | 今回わかったこと | 次に必要な検証 |
|---|---|---|
| Supabase RLS・権限 | クライアントのコメントだけが存在。SQL、migration、権限試験は同梱なし | 検証用DBで匿名のSELECT/INSERT/UPDATE/DELETE、列の公開範囲、本文・画像・配列・座標の上限を試験 |
| 削除RPC | クライアントはIDと秘密トークンを送信 | 正常/誤トークン/NULL/他投稿の拒否、定数時間比較等の必要性、関数所有者・GRANT・SECURITY DEFINER・search_pathを確認 |
| リアクションRPC | 画面の一回制限はローカル記録。匿名RPCを直接呼ぶ実装 | DB/入口側の重複防止と回数制限。連打で他人のポイントを増やせるかは未検証 |
| 投稿スパム | ブラウザから共有DBへ直接投稿 | 行ごとのRLS条件だけに依存せず、投稿頻度、全体容量、モデレーションを検証 |
| 画像URL・削除ハッシュ列 | `select=*`、受け取った写真URLを `img src` へ渡す | DBでJPEG等のdata URL形式を制限するか確認。任意外部画像による追跡、不要な列公開を防ぐ |
| HTTP保護ヘッダー | `next.config.mjs` にCSP等の設定はない | 実配信のCSP、frame-ancestors等、nosniff、Referrer-Policyを確認。アプリ側で未設定という事実だけで公開側の欠如とは断定しない |
| ローカル削除トークン | JavaScriptから読めるlocalStorageへ保存 | XSS時の影響範囲を認識し、CSP等を確認。継続運用で必要ならサーバー認証とHttpOnlyセッションへ移行 |
| 実行環境 | ローカルlockfileは取得可能 | 公開側の実バージョン、OS/libc、WAF、API利用上限、キー制限とログ保持を確認 |
| ビルド・実ブラウザ | `npm run build` を試したが `next` 実行ファイル不足で起動失敗 | 依存を正しく用意した環境でビルドし、実ブラウザとHTTP経由の試験を実施 |
| 開発用Python | ローカル素材を扱う画像生成補助スクリプトを静的確認 | Pillow等の固定版・依存一覧はなく、Python環境の脆弱性監査は未実施 |

RLSは外部公開スキーマの認可境界です。確認には[SupabaseのRLS資料](https://supabase.com/docs/guides/database/postgres/row-level-security)を参照してください。SQLが手元にないため、匿名利用者が他人の投稿を改変・削除できるとは断定していません。

## 検証記録と再実行

| 記録 | 結果 |
|---|---|
| `security-evidence/npm-audit.json` | 正常応答、終了コード1。Critical 1 / High 3 / 合計4パッケージ |
| `security-evidence/api-checks.json` | 18項目の期待挙動を確認。実通信0、実キー読取なし |
| `security-evidence/client-checks.json` | 6項目の期待挙動を確認。正常系、GPS送信、保存失敗、全文配信。実通信0 |
| `security-evidence/csv-checks.json` | 実CSVエンコーダーに対する無害な1入力。表計算ソフトは起動せず |
| `security-evidence/secret-scan-summary.json` | 到達可能2コミット・重複を除いたテキスト56 blob・8種のパターンで一致0 |
| `security-evidence/public-photo-exif.log` | 12枚すべてEXIFセグメントなし |
| `security-evidence/build.log` | 終了コード1。`next` が見つからずビルド開始前に失敗 |

**チェック数は安全性の合格数ではありません。問題を含む現在の挙動を再現できた件数です。** VMによるローカル試験はNext.jsのHTTP層、実ブラウザ、配信キャッシュ、実DB認可の試験を代替しません。

プロジェクトルートで次のスクリプトを実行できます。いずれもアプリのソースは変更せず、同じ証拠フォルダー内のJSONだけを更新します。

```powershell
node .docs/security-evidence/reproduce-api.mjs
node .docs/security-evidence/reproduce-client.mjs
node .docs/security-evidence/reproduce-export.mjs
node .docs/security-evidence/reproduce-secrets.mjs
```

最新の依存監査は `npm audit --ignore-scripts --json` で再取得できます。`npm audit fix` や依存更新は今回実施していません。

## 対応の順序

1. SEC-01の位置共有制御とSEC-03の公開前の削除手段確保を修正し、送信内容と保存失敗を再試験。
2. 有効Googleキーを設定して公開する前にSEC-02の利用上限を適用し、超過時に上流通信0となることを確認。
3. 検証用DBへRLS/RPC定義を再現し、他人の投稿の変更・削除や入力上限を試験。
4. 依存版を更新し、監査、ビルド、画像と投稿機能を再確認。SEC-05以降は運用用途に合わせて対応。

この記録は調査と検証結果です。上記の問題は未修正です。
