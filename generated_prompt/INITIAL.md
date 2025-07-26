ultrathink
私はアーキテクチャ(architecture)、設計テンプレート(design_template)に従った設計書を作成したいです。情報が不足している場合は、設計書を作る際に不足している情報は必ずユーザーに確認しなさい。保存可能ならspec/initial.mdにレポートを保存しなさい。

<architecture>
## 0. 目的
本ドキュメントではディレクトリ構造と開発ルール、依存方向、命名規則を体系的に示します。

---

## 1. ディレクトリ構成の全体図

```text
src/
├── lib/
│   └── server/
│       ├── features/            # ドメインごとのビジネスロジック
│       │   └── <Domain>/
│       │       ├── core/        # 純粋関数・ドメイン知識
│       │       │   ├── <Domain>.ts
│       │       │   ├── policy/
│       │       │   │   └── <Policy>.ts
│       │       │   └── port/
│       │       │       └── <Port>.ts
│       │       ├── command/
│       │       │   └── <Command>/
│       │       │       ├── core.ts
│       │       │       └── handler.ts
│       │       └── query/
│       │           └── <Query>/
│       │               ├── core.ts
│       │               └── handler.ts
│       ├── flows/               # 複数ドメインを束ねる Orchestrator
│       │   └── <Flow>/handler.ts
│       ├── adapter/             # 技術依存 (外部 API / DB / LLM …)
│       │   ├── repository/      # DB永続化実装
│       │   └── service/         # 外部API連携実装
│       ├── shared/              # ドメイン横断ユーティリティ
│       └── auth.ts              # 認証設定とヘルパー関数
└── routes/                      # SvelteKitルーティング（HTTPレイヤー）
    ├── [ページパス]/            # ページ用ルート
    │   ├── +page.svelte         # ページコンポーネント
    │   └── +page.server.ts      # サーバーサイド処理（load, actions）
    └── api/                     # 外部システム用APIエンドポイント
        └── [path]/+server.ts    # webhook、外部アプリ連携など
```

---

## 2. アーキテクチャ原則

### 2.1 サーバー・クライアント分離
- **サーバー側**: `/lib/server/` 配下にビジネスロジックを配置
- **クライアント側**: `/lib/features/<Domain>/client/` 配下にAPI呼び出しとUI表示ヘルパーを配置
- **DI不使用**: 各handlerで直接実装を使用（シンプルさを優先）

### 2.2 レイヤ責務と依存方向

| レイヤ               | 役割                                      | 依存できる相手               |
| ----------------- | --------------------------------------- | --------------------- |
| **core/**         | ビジネスロジックを純粋関数で実装。副作用ゼロ                  |                       |
| **policy/**       | 複数エンティティにまたがるドメイン規則                     | core/                 |
| **port/**         | 外部との境界面（interface のみ）                   | —                     |
| **command/query** | UseCase。直接実装を使用して副作用を実行                 | core/, adapter/       |
| **flows/**        | 複数ドメインの command/query を呼び出し順序を制御        | command/query         |
| **adapter/**      | 外部サービス実装（I/O）                           | —                     |
| **auth.ts**       | 認証設定とヘルパー関数（requireAuth, requireAdmin）    | adapter/, features/   |
| **routes/[page]/**| ページルート（+page.server.ts でサーバー処理）        | auth.ts, flows/, command/query |
| **routes/api/**   | 外部システム用API（webhook、モバイルアプリ等）        | auth.ts, flows/, command/query |

---

## 3. コーディングガイドライン

### 3.0 SvelteKitルーティング設計方針

#### ページルート（推奨）
* **基本原則**: ページで使用するデータの取得・更新は `+page.server.ts` で処理
* **load関数**: ページ表示に必要なデータを取得
* **actions**: フォーム送信によるデータ更新処理
* **例**: 管理画面、ユーザー画面、設定画面など

#### APIルート（特殊ケースのみ）
* `/api/` 配下は以下の特殊なケースでのみ使用：
  * **Webhook**: 外部サービスからのコールバック（例: LINE WORKS callback）
  * **外部アプリ連携**: モバイルアプリ、WOFFアプリなどSvelteKit外からのアクセス
  * **サードパーティ連携**: 他システムとのAPI連携
* **避けるべき例**: 管理画面のデータ取得・更新（→ +page.server.ts を使用）

### 3.1 core/

* Prisma のモデル型を **Readonly 型** として再利用
* 不変条件は Factory 関数 (`createXxx`) で保証
* 副作用（日時取得・UUID 生成も含む）は一切禁止

### 3.2 command/query/

* `core.ts` は入力検証・派生データ計算などを純粋関数で実装
* `handler.ts` では **直接実装インスタンス** を使用して副作用を実行
* 1 ファイル 200 行を超えたらロジックを core/ へ抽出

### 3.3 flows/

* 既存 command/query を **2 つ以上** 結合する場合のみ作成
* ビジネス条件分岐が 20 行を超える場合、判断部分を pure 関数に切り出す

### 3.4 adapter/

* 外部 API へのリトライ・サーキットブレーカは adapter 内にカプセル化
* ドメイン語彙を adapter に持ち込まない。必要なら mapper を挟む
* クラスでServiceやRepositoryを定義
* ChatModelやPrismaをそのまま返したりせず、invoke()や、query()などのメソッドを公開する
* adapter/repositoryにはリポジトリを定義。DBへのアクセスはRepository経由で行う
* adapter/serviceにはサービスを定義。LLM呼び出しや、外部API呼び出しはService経由で行う
* features/{Domain}/port/にProductRepositoryや、PaymentServiceなどの抽象化層を作成し実態をadapterに記述 

### 3.5 policy/
* core/で使う制約などを記載
* 単純すぎるものはcore/<Domain>.tsでチェックする
* 例えばOrderにCouponが設定できるかチェックする(canApplyCoupon)など

---

## 4. 実装パターン

### 4.1 Handler実装パターン

```ts
// src/lib/server/features/user/command/record-login/handler.ts
import { UserRepositoryPrisma } from '../../../adapter/repository/userRepository.prisma'
import type { RecordLoginInput } from './core'

// 実装を直接取得
const userRepository = new UserRepositoryPrisma()

export async function recordLogin(input: RecordLoginInput) {
  // ビジネスロジック
  return await userRepository.createLoginRecord(/* ... */)
}
```

### 4.2 ページルート実装パターン（推奨）

```ts
// src/routes/admin/user/+page.server.ts
import { requireAdmin } from '$lib/server/auth'
import { listAdminUsers } from '$lib/server/features/admin/query/list-admin-users/handler'
import { createAdminUser } from '$lib/server/features/admin/command/create-admin-user/handler'
import type { PageServerLoad, Actions } from './$types'

export const load: PageServerLoad = async (event) => {
  await requireAdmin(event)
  const users = await listAdminUsers()
  return { users }
}

export const actions: Actions = {
  create: async (event) => {
    await requireAdmin(event)
    const formData = await event.request.formData()
    const user = await createAdminUser({
      email: formData.get('email') as string,
      name: formData.get('name') as string
    })
    return { success: true, user }
  }
}
```

### 4.3 APIルート実装パターン（特殊ケースのみ）

```ts
// src/routes/api/lineworks/callback/+server.ts
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ request }) => {
  // Webhookの署名検証
  const signature = request.headers.get('x-works-signature')
  // ... 外部システムからのコールバック処理
  return new Response('OK', { status: 200 })
}
```

### 4.4 Adapter(Service)


#### インターフェイス
必ずportにInterfaceを置く

```ts
// src/lib/server/features/discord/port/discordService.ts

export interface DiscordService {
  // チャンネル情報の取得
  getChannel(channelId: string): Promise<DiscordChannelData | null>
  getChannels(): Promise<DiscordChannelData[]>

  // メッセージの取得
  getMessage(messageId: string): Promise<DiscordMessageData | null>
  getChannelMessages(channelId: string, limit?: number): Promise<DiscordMessageData[]>
  getRecentMessages(limit?: number): Promise<DiscordMessageData[]>

  // 同期関連
  syncChannelData(): Promise<{ synced: number; errors: string[] }>
  syncMessageData(channelId: string, limit?: number): Promise<{ synced: number; errors: string[] }>
  
  // 接続テスト
  testConnection(): Promise<boolean>
}

```

#### 実装
実装はadapter以下に置く。必要に応じてMockも作成する。

```ts
// src/lib/server/adapter/service/discord.service.ts
export class DiscordServicePrisma implements DiscordService {
  private discordBotToken: string;

  constructor() {
    this.discordBotToken = process.env.DISCORD_BOT_TOKEN || '';
    if (!this.discordBotToken) {
      throw new Error('DISCORD_BOT_TOKEN environment variable is required');
    }
  }

  async getChannelMessages(channelId: string, limit = 50): Promise<DiscordMessageData[]> {
    try {
      const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?limit=${limit}`, {
        headers: {
          'Authorization': `Bot ${this.discordBotToken}`,
          'Content-Type': 'application/json'
        }
      });
}
```

---

## 5. テスト戦略

| 階層             | テスト種類     | 特徴                    |
| -------------- | --------- | --------------------- |
| core/          | ユニット      | モック不要。DB/IO を使わない     |
| command/query/ | ユニット      | Port をダミー実装で注入        |
| flows/         | 統合 or E2E | 実際の command/query を結合 |
| adapter/       | 契約テスト     | モックサーバで外部 API を stub  |


## 6. CI ルール

1. **型チェック**: Prisma スキーマ変更後 `bun run db:generate` を必ず走らせる。
2. **依存監視**: `eslint-plugin-boundaries` で features → adapter 直 import を禁止。
3. **行数監視**: `handler.ts` は 200 行、`core/*.ts` は 300 行を閾値とし超過で警告。

---

## 7. よくある質問（FAQ）

**Q. なぜ flow を command/query と同じ features に置かない？**
A. Flow はドメイン横断のため別階層に切り離すことで、依存方向を一目で把握できます。

**Q. Adapter のテストは？**
A. 外部サービスに対しては契約テスト (pact)、DB は Testcontainer で e2e を行います。

**Q. いつ /api/ ルートを使うべき？**
A. webhook、外部アプリ（モバイル、WOFF等）、サードパーティ連携のみ。管理画面などの通常のWebページは +page.server.ts を使用。

**Q. 既存の /api/admin/ エンドポイントはどうすべき？**
A. 段階的に対応する +page.server.ts へ移行。新規機能は最初から +page.server.ts で実装。

---

## 8. Onboarding 5 ステップ

1. `src/features/<domain>/core/` を 3 ファイル読んでドメイン知識を把握。
2. `command/<sample>/handler.ts` を追って副作用パターンを学習。
3. 新規小さな Query を追加 → MR 提出。
5. CI で通るまで修正し、レビュープロセスを体験。

## 9. 実装手順
### 9-1. 新規開発の場合（ゼロからの設計）

全くゼロからの新規開発では、実装前に設計フェーズを重視し、間違いを防ぎつつ最小限のコードで進めるのが効果的です。Domain（ドメイン）から始め、Port（抽象インターフェイス）を明確に定義してから実装に移るアプローチをおすすめします。これで依存方向が崩れにくく、拡張しやすくなります。ドキュメント作成を並行します。


#### ステップ1: ドメインリスト作成
- **目的**: アプリ全体のドメインを洗い出し、依存関係を考慮した基盤を築く。
- **手順**:
  - 要件からドメインリストを列挙（例: user, payment）。各ドメインの概要と相互依存をテキストで記述。
  - ドキュメント作成: `.knowledge/domains.md`を作成。ドメインリストを表形式でまとめる（ドメイン名 | 概要 | 依存ドメイン）。
- **設計Tips**: Flowが必要な横断部分をここで特定（例: user-payment flow）。

#### ステップ2: 全体設計の計画とドキュメント基盤作成
- **目的**: 設計の青写真を描き、ガイドラインを文書化。すべてのDomainとFlowをまとめて定義。
- **手順**:
  - 要件洗い出し: アプリの目的を明確に。
  - ドキュメント作成: `.knowledge/architecture.md`を作成。ディレクトリ構成の全体図とアーキテクチャ原則をベースに最小版を作成。
    - **おすすめ内容**:
      - **ディレクトリ構造**: Markdownでツリー図。すべてのfeatures/<Domain>とflows/を含む。
      - **アーキテクチャ原則**: 表でレイヤ責務と依存方向。
      - **ドメイン概要**: テキストで全ドメインを記述（例: userドメイン: ユーザー作成・クエリ）。
      - **命名規則**: 抜粋（例: core/は純粋関数のみ）。
  - features/とflows/の構成図作成: 全ドメインとFlowをまとめてツリー図を作成（テキストベース）。これで構造レビューがやりやすい。
    - 例 (userドメイン):
      ```
      src/features/user/
      ├── core/
      │   └── user.ts
      ├── port/
      │   └── userRepository.ts
      ├── command/
      │   └── create-user/
      │       ├── core.ts
      │       └── handler.ts
      └── query/
          └── get-user/
              ├── core.ts
              └── handler.ts
      ```
    - 例 (flows/):
      ```
      src/flows/
      └── user-payment/
          └── handler.ts
      ```
  - Domainスケッチ: 全core/のエンティティと関数をドキュメントに記す。
  - command/query/とflows/設計: 全Domainのcoreとportを基にUseCaseを組み合わせ。handlerで直接インスタンス。複数ドメインのflowsをここで設計（2つ以上結合時）。
  - ドキュメント更新: `docs/usecases.md`にシーケンス（テキストで「入力 → core → adapter」）。
    - **おすすめ内容**:
      - **UseCaseカタログ**: 表 (コマンド名 | 入力型 | 出力型 | 依存Port | ルール)。
      - **flows判断**: 依存関係を記述。
- **設計Tips**: Portを仮定義。メソッドを最小に。ドキュメントにPortの役割を明記。flowsは最小限。


#### ステップ3: Domain駆動でcore/とport/の設計
- **目的**: 全Domainからportのインターフェイスを決定。依存方向を明確に。
- **手順**:
  - core/設計: Prismaスキーマを最小定義。全core/<Domain>.tsをスケッチ。
  - port/設計: coreのニーズからインターフェイス導出（例: createメソッドだけ）。
  - ドキュメント更新: `docs/interfaces.md`を作成。Portのコードスニペットと理由を記述。
    - **おすすめ内容**:
      - **Portカタログ**: 表 (メソッド名 | 入力 | 出力 | 目的)。
      - **依存フロー**: テキストで「core → port → adapter」と記述。
- **例コード** (port/):
  ```ts
  // src/features/user/port/userRepository.ts
  export interface UserRepository {
    create(user: { name: string }): Promise<{ id: string; name: string }>;
  }
  ```
- **設計Tips**: interface推奨。不変条件はcoreで保証。


#### ステップ3.5: 設計レビューとイテレーション
- **目的**: ステップ1-3の設計を自己反省し、不備を修正。完璧でない場合に繰り返しを入れる。
- **手順**:
  - レビュー: core/とport/の設計を振り返り、追加の関数やファイルが必要か確認（例: 新たなメソッドが判明したらportを更新）。
  - ドキュメント確認: 構成図やカタログに漏れがないかチェック。必要に応じてステップ2に戻り、ドメイン概要やツリー図を修正。
  - イテレーション: 不備があれば繰り返し（例: 1-2回）。これで一撃完璧でなくても調整可能。
- **設計Tips**: 依存方向の違反がないか確認。チームレビューも推奨。
。

#### ステップ4: adapter/の実装設計とコード化
- **目的**: Portに基づき実装を具体化。
- **手順**:
  - adapter/設計: Portを実装（例: Prisma）。カプセル化。
  - ドキュメント更新: `docs/adapters.md`に実装詳細とテスト戦略。
    - **おすすめ内容**:
      - **Adapterマニュアル**: コードスニペットとエラー処理。
      - **Mockガイド**: サンプルコード。
- **例コード** (adapter/):
  ```ts
  // src/adapter/repository/userRepository.prisma.ts
  import { PrismaClient } from '@prisma/client';
  import { UserRepository } from '../../features/user/port/userRepository';

  const prisma = new PrismaClient();

  export class UserRepositoryPrisma implements UserRepository {
    async create(user: { name: string }): Promise<{ id: string; name: string }> {
      return prisma.user.create({ data: user });
    }
  }
  ```
- **設計Tips**: ドメイン語彙を可能な限り避ける。

#### ステップ5: 全体接続・テスト・ドキュメント完成
- **目的**: 検証とドキュメント締め。
- **手順**:
  - interfaces/entrypoints接続。
  - テスト設計: `docs/tests.md`作成。
  - 最終ドキュメント: FAQ追加（例: Port設計の理由）。
- **設計Tips**: CIルール記載。


### 9-2. 機能追加/拡張の場合（既存プロジェクトへの実装）

既存プロジェクトに機能を追加する場合、依存方向を崩さないよう「内側（core/policy）から外側（adapter/interfaces）へ」実装を進めます。まずDB変更やビジネスロジック（features/flows）を固め、次に抽象層（port）と具体実装（adapter）を繋ぎ、最後にテストとクライアント側/エンドポイントを追加。途中でドキュメント更新とレビューを挟むことで、品質を確保します。

#### ステップ1: データベース変更の確認とPrismaスキーマ編集（必要時）
- **目的**: DB構造を更新し、型安全性を確保。変更がない場合、このステップをスキップ。
- **手順**:
  - 要件からDB変更が必要か確認（例: 新カラム追加、テーブル作成）。
  - Prismaスキーマ（prisma/schema.prisma）を編集（例: modelにフィールド追加）。
  - `bun run db:generate` を実行して型ファイルを生成。
  - `bun run db:reset` でDBをリセット、または本番環境では `bun run db:deploy` でマイグレーションを適用。
  - ドキュメント更新: `.knowledge/domains.md` や `docs/interfaces.md` にDB変更を反映（例: 新フィールドの説明）。
- **対象ファイル**: prisma/schema.prisma
- **Tips**: Readonly型としてcore/で再利用。不変条件はcore/のFactoryで保証。CIルールで型チェックを強制。

#### ステップ2: features/ と flows/ の実装（ビジネスロジック基盤）
- **目的**: ドメインの純粋関数とUseCaseを先に実装。これがないと後続のport/adapterが不明瞭になる。
- **手順**:
  - core/ : 純粋関数/エンティティを実装（副作用ゼロ）。PrismaモデルをReadonlyで再利用。不変条件をFactory関数で保証。
  - policy/ : 複数エンティティの規則を実装（例: canApplyCoupon）。単純なものはcore/に統合。
  - command/query/ : core.tsで入力検証/計算（純粋）、handler.tsでロジック概要（副作用は後で）。1ファイル200行超え時はcore/へ抽出。
  - flows/ : 複数ドメインのオーケストレーション（2つ以上のcommand/query結合時）。ビジネス分岐20行超え時はpure関数抽出。
  - ドキュメント更新: `docs/usecases.md` にUseCaseカタログ追加（表形式: コマンド名 | 入力型 | 出力型 | 依存Port）。
- **対象ファイル**:
  - src/features/<Domain>/core/<Domain>.ts
  - src/features/<Domain>/policy/<Policy>.ts
  - src/features/<Domain>/command/<Command>/{core.ts, handler.ts}
  - src/features/<Domain>/query/<Query>/{core.ts, handler.ts}
  - src/flows/<Flow>/handler.ts
- **Tips**: 依存方向を守る（core → policy → command/query → flows）。handler.tsではportを仮使用（後で実装）。

#### ステップ3: port/ の抽象インターフェイス修正/実装
- **目的**: 外部との境界面を定義。features/のニーズから導出。
- **手順**:
  - core/policy/command/queryのニーズからinterfaceを定義/修正（例: 新メソッド追加）。
  - メソッドを最小限に（入力/出力型明確）。
  - ドキュメント更新: `docs/interfaces.md` にPortカタログ追加（表: メソッド名 | 入力 | 出力 | 目的）。
- **対象ファイル**: src/features/<Domain>/port/<Port>.ts
- **Tips**: interface推奨。adapterの実装前にportを固めることで、依存逆転を実現。

#### ステップ4: adapter/ の具体クラス実装
- **目的**: 外部サービス/DBの実装をカプセル化。portを実装。
- **手順**:
  - repository/ : DBアクセス（Prisma経由）。クラスで定義、query()/invoke()メソッド公開。
  - service/ : 外部API/LLM呼び出し。リトライ/サーキットブレーカ内蔵。ドメイン語彙避け、mapper挟む。
  - Mock作成（テスト用）。
  - handler.tsで直接インスタンス使用（例: const repo = new UserRepositoryPrisma()）。
  - ドキュメント更新: `docs/adapters.md` に実装詳細/エラー処理追加。
- **対象ファイル**:
  - src/adapter/repository/<Repository>.prisma.ts
  - src/adapter/service/<Service>.ts
- **Tips**: portを実装する形で依存方向を守る。外部依存（env変数など）確認。

#### ステップ5: routes/ の実装（ページルート・APIエンドポイント）
- **目的**: SvelteKitのルーティングを実装。基本はページルート、特殊ケースのみAPI。
- **手順**:
  - **ページルート（推奨）**: routes/[page]/+page.server.ts でload関数とactionsを実装。
    - load: ページ表示用データ取得
    - actions: フォーム送信処理
  - **APIルート（特殊ケースのみ）**: routes/api/**/+server.ts でwebhook等を実装。
    - webhook、外部アプリ連携、サードパーティAPI連携のみ
  - 認証が必要な場合は `$lib/server/auth` から `requireAuth` や `requireAdmin` をインポート。
  - handler/flowsを直接インポートして使用（flows/優先）。
  - ドキュメント更新: `docs/usecases.md` にシーケンス追加。
- **対象ファイル**:
  - src/routes/**/+page.server.ts（ページルート）
  - src/routes/api/**/+server.ts（APIルート - 特殊ケースのみ）
  - src/lib/server/auth.ts（認証ヘルパー等）
- **Tips**: ページルートではPageServerLoad、Actions型を使用。APIルートではRequestHandler型を使用。

#### ステップ6: クライアント側ページ実装（UI）
- **目的**: SvelteKitのフォームアクションを活用したUI実装。
- **手順**:
  - **+page.svelte**: ページコンポーネントでUI実装。
    - フォーム送信: `use:enhance` を使用したプログレッシブエンハンスメント
    - データ表示: load関数から受け取ったデータを表示
  - **特殊ケースのみ**: 外部API呼び出しが必要な場合（WOFFアプリ等）
    - client/helper.ts でAPI呼び出しヘルパーを実装
  - ドキュメント更新: `.knowledge/domains.md` にクライアント側概要追加。
- **対象ファイル**:
  - src/routes/**/+page.svelte（ページコンポーネント）
  - src/lib/features/<Domain>/client/<Helper>.ts（特殊ケースのみ）
- **Tips**: 基本はフォーム送信。SPAライクな動作が必要な特殊ケースのみAPI呼び出し。

#### ステップ7: テスト実装
- **目的**: 各レイヤの品質確保。アーキテクチャのテスト戦略に従う。
- **手順**:
  - core/ : ユニットテスト（モック不要、副作用なし）。
  - command/query/ : ユニット（portダミー注入）。
  - flows/ : 統合/E2E（実際結合）。
  - adapter/ : 契約テスト（モックサーバ/Testcontainer）。
  - クライアント側: UIテスト（例: Vitest/Jest）。
  - カバレッジ確認（80%以上目安）。
  - ドキュメント更新: `docs/tests.md` にテストケース追加。
- **対象ファイル**: tests/ 配下（例: core.test.ts）
- **Tips**: エッジケース（無効入力、タイムアウト）含む。CIで自動実行。

#### ステップ8: レビュー/イテレーションとCIチェック（オプション）
- **目的**: 不備修正。全体整合性確認。
- **手順**:
  - 自己レビュー: 依存方向/行数チェック（eslint-plugin-boundaries使用）。
  - チームレビュー: MR提出。
  - CI実行: 型チェック/依存監視/行数警告。
  - イテレーション: 不備あればステップ2-7に戻る。
  - ドキュメント完成: FAQ追加（例: 新機能のQ&A）。
- **Tips**: Onboarding 5ステップを参考に新人向け説明追加。

#### ステップ9: デプロイ/運用準備（オプション）
- **目的**: 本番適用。
- **手順**:
  - 環境変数確認（adapter依存）。
  - マイグレーション適用。
  - 監視設定（エラーログなど）。
- **Tips**: ロールバック計画をドキュメントに記載。
--- 



</architecture>

<design_template>
# {プロジェクト名} 設計書

作成日: {YYYY-MM-DD}  
作成モデル: {ex: claude-4-sonnet, claude-4-opus, o3}  

## 1. 目的と概要
{プロジェクト全体の目的を簡潔に記述。アーキテクチャ原則の抜粋を引用して、設計の指針を示す。  

- 注意点/理由: このセクションはプロジェクトの全体像を共有するためのもの。抜粋を引用することで、アーキテクチャ遵守を意識させ、チームメンバーが一貫した理解を持つようにする。
例: 本プロジェクトは、ユーザー管理と支払い処理を統合したWebアプリを目的とする。アーキテクチャ原則に基づき、依存方向を厳守（coreは純粋関数のみ、副作用はhandler.tsで処理）。本テンプレートは、実装計画書の基盤を提供し、詳細設計は各実装計画書に委ねる。}


## 2. ドメインリスト
{ドメインを洗い出し、依存関係を表で記述。Flowの必要性を特定するための基盤とする。各ドメインの概要は、要件から抽出した簡単な役割を具体的に書く。  
- 注意点/理由: 表形式で視覚的にわかりやすくするため。概要を具体的に例示することで、ドメインの境界を明確にし、早期に依存のミスを発見できる。Flowのヒントを入れるのは、複数ドメインのオーケストレーションを設計段階で予見するため（アーキテクチャ原則のflows/参照）。
例: Userドメインはユーザー登録・認証を扱い、Paymentドメインは決済処理を担当。}

| ドメイン名 | 概要 | 依存ドメイン |
|------------|------|--------------|
| User      | ユーザー管理（登録、認証、プロフィール更新など） | なし        |
| Payment   | 支払い処理（決済実行、履歴管理など） | User        |
| ...       | ...  | ...         |


## 3. 全体アーキテクチャ図
{ディレクトリ構成のツリー図を作成。全ドメイン/Flowの枠組みを示す。詳細ファイル（例: 具体的なcommand名）は実装計画書で追加。  
例: features/user/の下にcore/policy/port/command/queryのサブディレクトリを想定。- **レイヤ責務の再確認**: {アーキテクチャ原則の表を簡略コピー。例: core/は副作用ゼロの純粋関数、adapter/は外部依存カプセル化。}
- **注意点/理由**: ツリー図は構造を一目で把握させるための視覚ツール。例を入れることで、抽象的なディレクトリが具体的にイメージしやすくなり、レビュー時の議論を促進。レイヤ責務を再確認するのは、依存方向の違反を防ぐため。
}

```
src/
├── features/
│   ├── user/  # core/policy/port/command/queryの枠組み（例: core/user.tsで純粋関数定義）
│   └── payment/  # 同上（例: port/paymentService.tsで外部API抽象化）
├── flows/
│   └── user-payment/  # handler.tsのみ（例: 複数ドメインの順序制御）
├── adapter/  # repository/serviceの枠組み（例: repository/userRepository.prisma.ts）
├── interfaces/
└── shared/
```


## 4. UseCaseカタログ
{全command/query/Flowの概要カタログを作成。詳細要件（入力/出力型、エッジケース）は実装計画書の3.2で扱う。各UseCaseの概要は、期待される動作を簡潔に例示。

- シーケンス概要: {高レベルなフロー記述。例: interfaces/api → flows/handler → command/handler → adapter/repository。詳細シーケンスは実装計画書の3.2で定義。}
- 注意点/理由: 表をシンプルに保つことで、UseCaseの全体像を素早く把握。概要に具体的な動作例を入れるのは、テンプレート使用者が「何を書くか」のモデルを提供するため。シーケンスを高レベルに留めるのは、設計段階での柔軟性を確保し、詳細を後回しにするため。
- 公開範囲: {UseCaseごとにpublicかinternalを指定。ドメイン内に閉じているinternalの場合はUseCase名の先頭に_を付与すること。}
}

| UseCase名 | タイプ | 概要 | 公開範囲 |
|-----------|--------|------|----------|
| create-user | command | ユーザー作成（入力検証後、DB保存） | public |
| get-user | query | ユーザー取得（ID指定でデータ返却） | public |
| _user-payment | flow | ユーザー支払い処理（ユーザー認証後、決済実行） | internal |
| ... | ... | ... | ... |


## 5. Portカタログ
{Portの抽象概要を作成。Repository（DBアクセス）とService（外部API/LLM呼び出し）の両方をカバー。目的は役割を抽象的に例示。詳細メソッドや実装は実装計画書の4.3で扱う。
- ガイドライン: {interface推奨。RepositoryはDB永続化中心、Serviceは外部サービスカプセル化を意識。ドメイン語彙の扱いなど、アーキテクチャガイドラインを参照。}
- 注意点/理由: タイプを明示することで、Repository/Serviceの区別を明確にし、adapter/の実装方針を予見。目的に例を入れるのは、抽象的なPortが具体的に理解しやすくなり、設計の漏れを防ぐため。ガイドライン参照を促すのは、アーキテクチャ原則の遵守を強化するため。
}

| Port名 | タイプ (Repository/Service) | 目的 |
|--------|-----------------------------|------|
| UserRepository | Repository | ユーザーDB操作（例: 作成・取得・更新の抽象インターフェイス） |
| PaymentService | Service | 外部支払いAPI呼び出し（例: 決済処理・検証の抽象化） |
| ... | ... | ... |


## 6. テスト戦略概要
{レイヤごとの高レベル計画を作成。詳細ケースは実装計画書の3.5で扱う。各特徴概要に簡単な例を追加。
- 注意点/理由: 概要に例を入れることで、テストのイメージを具体化。全体を高レベルに留めるのは、設計段階でテストの枠組みだけを決めておき、詳細を実装時に柔軟に調整するため。
}

| レイヤ | テスト種類 | 特徴概要 |
|--------|------------|----------|
| core/ | ユニット | モック不要（例: 純粋関数の入力/出力検証） |
| command/query/ | ユニット | Portダミー注入（例: 副作用の模擬実行） |
| ... | ... | ... |


## 7. レビューとイテレーション計画
{ステップ3.5に基づき記述。実装計画書作成前のチェックポイントを具体的に例示。  
例: レビュー項目: 依存方向違反の確認（例: core/にadapter依存がないか）、ドメイン漏れのチェック。イテレーション: 1-2回想定、不備時はセクション2に戻る。}

## 8. FAQ/追加考慮
{設計時のQ&Aを記述。例: Q. 詳細はどこで定義？ A. 実装計画書の詳細要件セクション（3.2）。Q. Flowを作成する基準は？ A. 2つ以上のcommand/query結合時（アーキテクチャ原則参照）。}

</design_template>

追加情報:
