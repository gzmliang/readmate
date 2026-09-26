#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把读伴书页（Reader）的 80 个键写入 8 种语言词典（只做加法，不改动已有键）"""
import json, os, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOC = os.path.join(ROOT, '_locales')

K = collections.OrderedDict  # 保持顺序

# 键 -> {locale: 文案}
T = {
 'rdrDocTitle':        {'zh_CN':'读伴书页','en':'ReadMate Reader','ja':'ReadMate リーダー','ko':'ReadMate 리더','de':'ReadMate Reader','fr':'ReadMate Reader','es':'ReadMate Reader','ru':'ReadMate Reader'},
 'rdrToc':             {'zh_CN':'目录','en':'Contents','ja':'目次','ko':'목차','de':'Inhalt','fr':'Sommaire','es':'Índice','ru':'Содержание'},
 'rdrTocTitle':        {'zh_CN':'章节目录','en':'Chapters','ja':'章一覧','ko':'챕터 목록','de':'Kapitel','fr':'Chapitres','es':'Capítulos','ru':'Главы'},
 'rdrTypo':            {'zh_CN':'排版','en':'Typography','ja':'レイアウト','ko':'조판','de':'Typografie','fr':'Typographie','es':'Tipografía','ru':'Типографика'},
 'rdrTypoTitle':       {'zh_CN':'排版设置','en':'Typography','ja':'レイアウト設定','ko':'조판 설정','de':'Typografie','fr':'Typographie','es':'Tipografía','ru':'Типографика'},
 'rdrBilingual':       {'zh_CN':'双语','en':'Bilingual','ja':'バイリンガル','ko':'이중 언어','de':'Zweisprachig','fr':'Bilingue','es':'Bilingüe','ru':'Двуязычный'},
 'rdrExport':          {'zh_CN':'导出','en':'Export','ja':'書き出し','ko':'내보내기','de':'Export','fr':'Exporter','es':'Exportar','ru':'Экспорт'},
 'rdrLibrary':         {'zh_CN':'书库','en':'Library','ja':'ライブラリ','ko':'서재','de':'Bibliothek','fr':'Bibliothèque','es':'Biblioteca','ru':'Библиотека'},
 'rdrLandingTitle':    {'zh_CN':'读伴书页','en':'ReadMate Reader','ja':'ReadMate リーダー','ko':'ReadMate 리더','de':'ReadMate Reader','fr':'ReadMate Reader','es':'ReadMate Reader','ru':'ReadMate Reader'},
 'rdrLandingDesc':     {'zh_CN':'把 txt / Markdown 文稿拖进来，就是一页排版精美的书——朗读、双语对照、导出一步到位。','en':'Drop a txt or Markdown file and it becomes a beautifully typeset book — read aloud, bilingual view and export in one place.','ja':'txt / Markdown をドロップするだけで、美しく組版された一冊に。朗読・対訳・書き出しまでこれ一つで。','ko':'txt / Markdown 파일을 떨어뜨리면 한 권의 책이 됩니다. 낭독, 대역, 내보내기까지 한곳에서.','de':'Ziehen Sie eine txt- oder Markdown-Datei hinein — daraus wird ein schön gesetztes Buch mit Vorlesen, zweisprachiger Ansicht und Export.','fr':'Déposez un fichier txt ou Markdown : il devient un livre élégamment composé, avec lecture à voix haute, vue bilingue et export.','es':'Suelta un archivo txt o Markdown y se convertirá en un libro bien maquetado: lectura en voz alta, vista bilingüe y exportación.','ru':'Перетащите файл txt или Markdown — и он превратится в красиво свёрстанную книгу: чтение вслух, двуязычный режим и экспорт.'},
 'rdrDropHint':        {'zh_CN':'把 .txt / .md 文件拖到这里（epub 与 PDF 即将支持）','en':'Drop a .txt / .md file here (epub and PDF coming soon)','ja':'ここに .txt / .md をドロップ（epub と PDF は近日対応）','ko':'여기에 .txt / .md 파일을 놓으세요 (epub, PDF 곧 지원)','de':'.txt-/.md-Datei hier ablegen (epub und PDF folgen bald)','fr':'Déposez un fichier .txt / .md ici (epub et PDF bientôt disponibles)','es':'Suelta aquí un archivo .txt / .md (epub y PDF muy pronto)','ru':'Перетащите сюда файл .txt / .md (epub и PDF скоро)'},
 'rdrChooseFile':      {'zh_CN':'选择文件','en':'Choose a file','ja':'ファイルを選択','ko':'파일 선택','de':'Datei wählen','fr':'Choisir un fichier','es':'Elegir un archivo','ru':'Выбрать файл'},
 'rdrDropAnywhere':    {'zh_CN':'松手即可导入','en':'Drop the file to import','ja':'離して読み込む','ko':'놓으면 가져옵니다','de':'Loslassen zum Importieren','fr':'Relâchez pour importer','es':'Suelta para importar','ru':'Отпустите, чтобы импортировать'},
 'rdrRecent':          {'zh_CN':'最近阅读','en':'Recently read','ja':'最近読んだ本','ko':'최근 읽은 책','de':'Zuletzt gelesen','fr':'Lus récemment','es':'Leídos recientemente','ru':'Недавно читали'},
 'rdrRecentNote':      {'zh_CN':'只记住读到第几章第几页，书稿始终留在您本地——再次选择同一个文件即可接着读。','en':'Only your reading position is remembered; the file stays on your device — pick the same file again to continue.','ja':'記憶するのは読んだ位置だけ。ファイルは端末内に残ります。同じファイルを選べば続きから読めます。','ko':'기억하는 것은 읽은 위치뿐이며 파일은 기기에 남습니다. 같은 파일을 다시 선택하면 이어서 읽습니다.','de':'Nur Ihre Leseposition wird gespeichert, die Datei bleibt bei Ihnen — dieselbe Datei erneut wählen und weiterlesen.','fr':'Seule votre position de lecture est mémorisée, le fichier reste chez vous — resélectionnez-le pour continuer.','es':'Solo se recuerda tu posición de lectura; el archivo permanece en tu equipo. Vuelve a elegirlo para continuar.','ru':'Сохраняется только позиция чтения, файл остаётся у вас — выберите его снова, чтобы продолжить.'},
 'rdrFontSize':        {'zh_CN':'字号','en':'Font size','ja':'文字サイズ','ko':'글자 크기','de':'Schriftgröße','fr':'Taille du texte','es':'Tamaño de letra','ru':'Размер шрифта'},
 'rdrLineHeight':      {'zh_CN':'行距','en':'Line height','ja':'行間','ko':'줄 간격','de':'Zeilenabstand','fr':'Interligne','es':'Interlineado','ru':'Межстрочный интервал'},
 'rdrMeasure':         {'zh_CN':'页宽','en':'Line width','ja':'一行の字数','ko':'한 줄 글자 수','de':'Zeilenbreite','fr':'Largeur de ligne','es':'Ancho de línea','ru':'Ширина строки'},
 'rdrParaGap':         {'zh_CN':'段距','en':'Paragraph gap','ja':'段落間隔','ko':'문단 간격','de':'Absatzabstand','fr':'Espace entre paragraphes','es':'Espacio entre párrafos','ru':'Интервал между абзацами'},
 'rdrIndentLabel':     {'zh_CN':'首行缩进','en':'First-line indent','ja':'字下げ','ko':'첫 줄 들여쓰기','de':'Erstzeileneinzug','fr':'Retrait de première ligne','es':'Sangría de primera línea','ru':'Отступ первой строки'},
 'rdrFontLabel':       {'zh_CN':'字体','en':'Font','ja':'書体','ko':'글꼴','de':'Schrift','fr':'Police','es':'Fuente','ru':'Шрифт'},
 'rdrFontSong':        {'zh_CN':'宋体','en':'Serif','ja':'明朝体','ko':'명조체','de':'Serif','fr':'Serif','es':'Serif','ru':'С засечками'},
 'rdrFontHei':         {'zh_CN':'黑体','en':'Sans','ja':'ゴシック体','ko':'고딕체','de':'Sans','fr':'Sans','es':'Sans','ru':'Без засечек'},
 'rdrFontKai':         {'zh_CN':'楷体','en':'Kai','ja':'楷書体','ko':'해서체','de':'Kai','fr':'Kai','es':'Kai','ru':'Кай'},
 'rdrFontSans':        {'zh_CN':'无衬线','en':'System','ja':'システム','ko':'시스템','de':'System','fr':'Système','es':'Sistema','ru':'Системный'},
 'rdrAlignLabel':      {'zh_CN':'对齐','en':'Alignment','ja':'行揃え','ko':'정렬','de':'Ausrichtung','fr':'Alignement','es':'Alineación','ru':'Выравнивание'},
 'rdrAlignJustify':    {'zh_CN':'两端','en':'Justified','ja':'両端揃え','ko':'양쪽 정렬','de':'Blocksatz','fr':'Justifié','es':'Justificado','ru':'По ширине'},
 'rdrAlignLeft':       {'zh_CN':'左对齐','en':'Left','ja':'左揃え','ko':'왼쪽 정렬','de':'Linksbündig','fr':'À gauche','es':'Izquierda','ru':'По левому краю'},
 'rdrModeLabel':       {'zh_CN':'双语呈现','en':'Bilingual view','ja':'対訳の表示','ko':'이중 언어 표시','de':'Zweisprachige Ansicht','fr':'Affichage bilingue','es':'Vista bilingüe','ru':'Двуязычный вид'},
 'rdrModeOriginal':    {'zh_CN':'仅原文','en':'Original','ja':'原文のみ','ko':'원문만','de':'Nur Original','fr':'Original','es':'Solo original','ru':'Только оригинал'},
 'rdrModeStacked':     {'zh_CN':'上下对照','en':'Stacked','ja':'上下対訳','ko':'위아래 대역','de':'Untereinander','fr':'Superposé','es':'Apilado','ru':'Друг под другом'},
 'rdrModeColumns':     {'zh_CN':'左右对照','en':'Side by side','ja':'左右対訳','ko':'좌우 대역','de':'Nebeneinander','fr':'Côte à côte','es':'Lado a lado','ru':'Рядом'},
 'rdrModeTranslated':  {'zh_CN':'仅译文','en':'Translation','ja':'訳文のみ','ko':'번역문만','de':'Nur Übersetzung','fr':'Traduction','es':'Solo traducción','ru':'Только перевод'},
 'rdrOtherLabel':      {'zh_CN':'其它','en':'More','ja':'その他','ko':'기타','de':'Mehr','fr':'Plus','es':'Más','ru':'Ещё'},
 'rdrIndentToggle':    {'zh_CN':'首行缩进','en':'Indent','ja':'字下げ','ko':'들여쓰기','de':'Einzug','fr':'Retrait','es':'Sangría','ru':'Отступ'},
 'rdrAutoTranslate':   {'zh_CN':'预翻全章','en':'Pre-translate','ja':'章全体を先に翻訳','ko':'챕터 전체 미리 번역','de':'Kapitel vorübersetzen','fr':'Pré-traduire','es':'Pretraducir','ru':'Перевести главу заранее'},
 'rdrPrintPreview':    {'zh_CN':'打印预览','en':'Print preview','ja':'印刷プレビュー','ko':'인쇄 미리보기','de':'Druckvorschau','fr':'Aperçu avant impression','es':'Vista previa','ru':'Предпросмотр печати'},
 'rdrReset':           {'zh_CN':'恢复默认','en':'Reset','ja':'初期設定','ko':'기본값','de':'Zurücksetzen','fr':'Réinitialiser','es':'Restablecer','ru':'Сбросить'},
 'rdrPanelHint':       {'zh_CN':'译文边读边译并自动缓存，翻过的段落不会再翻第二次。','en':'Translations are fetched on demand and cached, so the same paragraph is never translated twice.','ja':'訳文は必要になった時点で取得し、キャッシュします。同じ段落を二度翻訳することはありません。','ko':'번역은 필요할 때 가져와 캐시하므로 같은 문단을 두 번 번역하지 않습니다.','de':'Übersetzungen werden bei Bedarf geholt und zwischengespeichert — kein Absatz wird zweimal übersetzt.','fr':'Les traductions sont récupérées à la demande et mises en cache : un même paragraphe n’est jamais traduit deux fois.','es':'Las traducciones se obtienen cuando hacen falta y se guardan en caché: ningún párrafo se traduce dos veces.','ru':'Переводы загружаются по мере необходимости и кэшируются — один абзац не переводится дважды.'},
 'rdrThemeSepia':      {'zh_CN':'米黄书卷','en':'Sepia','ja':'セピア','ko':'세피아','de':'Sepia','fr':'Sépia','es':'Sepia','ru':'Сепия'},
 'rdrThemeLight':      {'zh_CN':'纯白','en':'Light','ja':'ホワイト','ko':'화이트','de':'Hell','fr':'Clair','es':'Claro','ru':'Светлая'},
 'rdrThemeGreen':      {'zh_CN':'护眼绿','en':'Green','ja':'グリーン','ko':'그린','de':'Grün','fr':'Vert','es':'Verde','ru':'Зелёная'},
 'rdrThemeEink':       {'zh_CN':'墨水屏灰','en':'E-ink','ja':'E-ink','ko':'E-ink','de':'E-Ink','fr':'E-ink','es':'E-ink','ru':'E-ink'},
 'rdrThemeMidnight':   {'zh_CN':'午夜蓝','en':'Midnight','ja':'ミッドナイト','ko':'미드나이트','de':'Mitternacht','fr':'Minuit','es':'Medianoche','ru':'Полночь'},
 'rdrThemeDark':       {'zh_CN':'夜间黑','en':'Dark','ja':'ダーク','ko':'다크','de':'Dunkel','fr':'Sombre','es':'Oscuro','ru':'Тёмная'},
 'rdrPrevChapter':     {'zh_CN':'上一章','en':'Previous','ja':'前の章','ko':'이전 장','de':'Zurück','fr':'Précédent','es':'Anterior','ru':'Назад'},
 'rdrNextChapter':     {'zh_CN':'下一章','en':'Next','ja':'次の章','ko':'다음 장','de':'Weiter','fr':'Suivant','es':'Siguiente','ru':'Вперёд'},
 'rdrChapter':         {'zh_CN':'第 {n} 章','en':'Chapter {n}','ja':'第 {n} 章','ko':'제 {n} 장','de':'Kapitel {n}','fr':'Chapitre {n}','es':'Capítulo {n}','ru':'Глава {n}'},
 'rdrChapterOf':       {'zh_CN':'第 {cur} / {total} 章','en':'Chapter {cur} of {total}','ja':'第 {cur} / {total} 章','ko':'제 {cur} / {total} 장','de':'Kapitel {cur} von {total}','fr':'Chapitre {cur} sur {total}','es':'Capítulo {cur} de {total}','ru':'Глава {cur} из {total}'},
 'rdrUnitChars':       {'zh_CN':'{n} 字','en':'{n} chars','ja':'{n} 字','ko':'{n}자','de':'{n} Zeichen','fr':'{n} caractères','es':'{n} caracteres','ru':'{n} симв.'},
 'rdrUntitled':        {'zh_CN':'未命名文稿','en':'Untitled','ja':'無題','ko':'제목 없음','de':'Ohne Titel','fr':'Sans titre','es':'Sin título','ru':'Без названия'},
 'rdrReadPct':         {'zh_CN':'已读 {n}%','en':'{n}% read','ja':'{n}% 読了','ko':'{n}% 읽음','de':'{n}% gelesen','fr':'{n}% lu','es':'{n}% leído','ru':'прочитано {n}%'},
 'rdrImporting':       {'zh_CN':'正在导入并排版…','en':'Importing and typesetting…','ja':'読み込みと組版中…','ko':'가져와 조판하는 중…','de':'Wird importiert und gesetzt…','fr':'Importation et composition…','es':'Importando y maquetando…','ru':'Импорт и вёрстка…'},
 'rdrImported':        {'zh_CN':'导入成功','en':'Import complete','ja':'読み込み完了','ko':'가져오기 완료','de':'Import abgeschlossen','fr':'Importation terminée','es':'Importación completada','ru':'Импорт завершён'},
 'rdrImportEmpty':     {'zh_CN':'这个文件里没有找到可朗读的正文','en':'No readable text found in this file','ja':'読み上げ可能な本文が見つかりません','ko':'읽을 수 있는 본문이 없습니다','de':'Kein lesbarer Text in dieser Datei gefunden','fr':'Aucun texte lisible trouvé dans ce fichier','es':'No se encontró texto legible en este archivo','ru':'В файле не найден текст для чтения'},
 'rdrImportFailed':    {'zh_CN':'导入失败，请换一个文件试试','en':'Import failed, please try another file','ja':'読み込みに失敗しました。別のファイルをお試しください','ko':'가져오기에 실패했습니다. 다른 파일을 시도해 주세요','de':'Import fehlgeschlagen, bitte eine andere Datei versuchen','fr':'Importation échouée, essayez un autre fichier','es':'Error al importar, prueba con otro archivo','ru':'Не удалось импортировать, попробуйте другой файл'},
 'rdrFormatPlanned':   {'zh_CN':'{ext} 格式还在路上，敬请期待','en':'{ext} support is on the way','ja':'{ext} は近日対応予定です','ko':'{ext} 형식은 곧 지원됩니다','de':'{ext} folgt in Kürze','fr':'Le format {ext} arrive bientôt','es':'El formato {ext} llegará pronto','ru':'Поддержка {ext} скоро появится'},
 'rdrFormatUnsupported':{'zh_CN':'暂不支持 {ext} 格式','en':'{ext} files are not supported yet','ja':'{ext} 形式は未対応です','ko':'{ext} 형식은 지원되지 않습니다','de':'{ext}-Dateien werden noch nicht unterstützt','fr':'Le format {ext} n’est pas encore pris en charge','es':'El formato {ext} aún no es compatible','ru':'Формат {ext} пока не поддерживается'},
 'rdrResumed':         {'zh_CN':'已回到上次读到的地方','en':'Resumed where you left off','ja':'前回の続きから再開しました','ko':'지난번 읽던 위치에서 이어집니다','de':'Weiter an der letzten Stelle','fr':'Reprise là où vous vous étiez arrêté','es':'Continúas donde lo dejaste','ru':'Продолжаем с места остановки'},
 'rdrNeedReimport':    {'zh_CN':'重新选择同一个文件即可接着读','en':'pick the same file again to continue','ja':'同じファイルを選ぶと続きから読めます','ko':'같은 파일을 다시 선택하면 이어서 읽습니다','de':'dieselbe Datei erneut wählen, um fortzufahren','fr':'resélectionnez le même fichier pour continuer','es':'elige el mismo archivo para continuar','ru':'выберите тот же файл, чтобы продолжить'},
 'rdrRemove':          {'zh_CN':'从记录里移除','en':'Remove from history','ja':'履歴から削除','ko':'기록에서 삭제','de':'Aus Verlauf entfernen','fr':'Retirer de l’historique','es':'Quitar del historial','ru':'Удалить из истории'},
 'rdrReadTip':         {'zh_CN':'点右下角 ▶ 圆球即可开口朗读本章','en':'Tap the ▶ bubble to read this chapter aloud','ja':'右下の ▶ を押すと本章を読み上げます','ko':'오른쪽 아래 ▶ 를 누르면 이 장을 읽어 줍니다','de':'▶ unten rechts liest dieses Kapitel vor','fr':'Touchez le bouton ▶ pour lire ce chapitre à voix haute','es':'Pulsa el ▶ para leer este capítulo en voz alta','ru':'Нажмите ▶ справа внизу, чтобы прочитать главу вслух'},
 'rdrTransProgress':   {'zh_CN':'正在翻译本章（{done}/{total} 段）…','en':'Translating this chapter ({done}/{total} paragraphs)…','ja':'本章を翻訳中（{done}/{total} 段落）…','ko':'이 장을 번역하는 중 ({done}/{total} 문단)…','de':'Kapitel wird übersetzt ({done}/{total} Absätze)…','fr':'Traduction du chapitre ({done}/{total} paragraphes)…','es':'Traduciendo el capítulo ({done}/{total} párrafos)…','ru':'Переводим главу ({done}/{total} абзацев)…'},
 'rdrTransDone':       {'zh_CN':'本章译文已就绪','en':'Chapter translation ready','ja':'本章の訳文ができました','ko':'이 장의 번역이 준비되었습니다','de':'Kapitelübersetzung fertig','fr':'Traduction du chapitre prête','es':'Traducción del capítulo lista','ru':'Перевод главы готов'},
 'rdrTransFailed':     {'zh_CN':'翻译暂时不可用，稍后可再试','en':'Translation is unavailable right now, please try again later','ja':'翻訳サービスに接続できません。しばらくして再試行してください','ko':'지금은 번역을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요','de':'Übersetzung derzeit nicht verfügbar, bitte später erneut versuchen','fr':'Traduction indisponible pour le moment, réessayez plus tard','es':'La traducción no está disponible ahora, inténtalo más tarde','ru':'Перевод сейчас недоступен, попробуйте позже'},
 'rdrExportTitle':     {'zh_CN':'导出','en':'Export','ja':'書き出し','ko':'내보내기','de':'Export','fr':'Exporter','es':'Exportar','ru':'Экспорт'},
 'rdrExportSub':       {'zh_CN':'同一本书，三种带走方式','en':'Three ways to take this book with you','ja':'この一冊を持ち出す 3 つの方法','ko':'이 책을 가져가는 세 가지 방법','de':'Drei Wege, dieses Buch mitzunehmen','fr':'Trois façons d’emporter ce livre','es':'Tres formas de llevarte este libro','ru':'Три способа забрать книгу с собой'},
 'rdrExportPdfT':      {'zh_CN':'打印 / 存为 PDF','en':'Print / Save as PDF','ja':'印刷 / PDF 保存','ko':'인쇄 / PDF 저장','de':'Drucken / als PDF speichern','fr':'Imprimer / Enregistrer en PDF','es':'Imprimir / Guardar como PDF','ru':'Печать / Сохранить в PDF'},
 'rdrExportPdfD':      {'zh_CN':'按当前字体、页宽与双语版式出 PDF（在弹出的打印窗口里选「另存为 PDF」）','en':'Exports a PDF with your current typography and bilingual layout (choose “Save as PDF” in the print dialog)','ja':'現在の書体・一行字数・対訳レイアウトで PDF を作ります（印刷画面で「PDF に保存」を選択）','ko':'현재 글꼴, 한 줄 글자 수, 대역 레이아웃 그대로 PDF로 만듭니다 (인쇄 창에서 "PDF로 저장" 선택)','de':'Erzeugt ein PDF mit Ihrer aktuellen Typografie und zweisprachigen Ansicht (im Druckdialog „Als PDF speichern“ wählen)','fr':'Génère un PDF avec votre typographie et votre mise en page bilingue actuelles (choisissez « Enregistrer au format PDF »)','es':'Genera un PDF con tu tipografía y diseño bilingüe actuales (elige «Guardar como PDF»)','ru':'Создаёт PDF с текущей типографикой и двуязычной вёрсткой (выберите «Сохранить как PDF»)'},
 'rdrExportHtmlT':     {'zh_CN':'双语 HTML 单文件','en':'Bilingual HTML (single file)','ja':'対訳 HTML（1ファイル）','ko':'대역 HTML (단일 파일)','de':'Zweisprachiges HTML (eine Datei)','fr':'HTML bilingue (fichier unique)','es':'HTML bilingüe (archivo único)','ru':'Двуязычный HTML (один файл)'},
 'rdrExportHtmlD':     {'zh_CN':'一个文件装下原文与译文，离线可读，手机电脑都能打开','en':'One offline file with the original text and its translation, opens on any device','ja':'原文と訳文を 1 ファイルに。オフラインで読め、スマホでも PC でも開けます','ko':'원문과 번역을 한 파일에. 오프라인에서 열리며 휴대폰과 PC 모두 가능합니다','de':'Eine Offline-Datei mit Original und Übersetzung, öffnet auf jedem Gerät','fr':'Un seul fichier hors ligne avec le texte original et sa traduction, ouvrable partout','es':'Un solo archivo sin conexión con el original y su traducción, se abre en cualquier equipo','ru':'Один офлайн-файл с оригиналом и переводом, открывается где угодно'},
 'rdrExportPlainT':    {'zh_CN':'原文 HTML 单文件','en':'Plain HTML (single file)','ja':'原文 HTML（1ファイル）','ko':'원문 HTML (단일 파일)','de':'HTML nur Original (eine Datei)','fr':'HTML original (fichier unique)','es':'HTML solo original (archivo único)','ru':'HTML только оригинал (один файл)'},
 'rdrExportPlainD':    {'zh_CN':'只带原文，不联网，秒出','en':'Original text only, no network needed, exported instantly','ja':'原文のみ。通信不要で即時に書き出します','ko':'원문만 담고 네트워크 없이 즉시 내보냅니다','de':'Nur Originaltext, ohne Netzwerk, sofort fertig','fr':'Texte original uniquement, sans réseau, export immédiat','es':'Solo el original, sin conexión, al instante','ru':'Только оригинал, без сети, мгновенно'},
 'rdrExportWorking':   {'zh_CN':'正在准备…（{done}/{total}）','en':'Preparing… ({done}/{total})','ja':'準備中…（{done}/{total}）','ko':'준비 중… ({done}/{total})','de':'Wird vorbereitet… ({done}/{total})','fr':'Préparation… ({done}/{total})','es':'Preparando… ({done}/{total})','ru':'Подготовка… ({done}/{total})'},
 'rdrExportDone':      {'zh_CN':'已导出：{name}','en':'Exported: {name}','ja':'書き出しました：{name}','ko':'내보냈습니다: {name}','de':'Exportiert: {name}','fr':'Exporté : {name}','es':'Exportado: {name}','ru':'Экспортировано: {name}'},
 'rdrExportFailed':    {'zh_CN':'导出失败，请稍后再试','en':'Export failed, please try again','ja':'書き出しに失敗しました。もう一度お試しください','ko':'내보내기에 실패했습니다. 다시 시도해 주세요','de':'Export fehlgeschlagen, bitte erneut versuchen','fr':'Échec de l’export, réessayez','es':'Error al exportar, inténtalo de nuevo','ru':'Не удалось экспортировать, попробуйте снова'},
 'rdrOpenFirst':       {'zh_CN':'请先导入或打开一本书','en':'Import or open a book first','ja':'先に本を読み込んでください','ko':'먼저 책을 가져오거나 열어 주세요','de':'Bitte zuerst ein Buch importieren oder öffnen','fr':'Importez ou ouvrez d’abord un livre','es':'Primero importa o abre un libro','ru':'Сначала импортируйте или откройте книгу'},
 'rdrCancel':          {'zh_CN':'取消','en':'Cancel','ja':'キャンセル','ko':'취소','de':'Abbrechen','fr':'Annuler','es':'Cancelar','ru':'Отмена'},
 'rdrResetDone':       {'zh_CN':'已恢复默认排版','en':'Typography reset to default','ja':'レイアウトを初期設定に戻しました','ko':'조판을 기본값으로 되돌렸습니다','de':'Typografie auf Standard zurückgesetzt','fr':'Typographie réinitialisée','es':'Tipografía restablecida','ru':'Типографика сброшена'},
 'rdrModeTip':         {'zh_CN':'双语版式','en':'Bilingual layout','ja':'対訳レイアウト','ko':'대역 레이아웃','de':'Zweisprachige Ansicht','fr':'Disposition bilingue','es':'Diseño bilingüe','ru':'Двуязычная вёрстка'},
}

LOCALES = ['zh_CN', 'en', 'ja', 'ko', 'de', 'fr', 'es', 'ru']

def main():
    for loc in LOCALES:
        p = os.path.join(LOC, loc, 'messages.json')
        with open(p, encoding='utf-8') as f:
            data = json.load(f, object_pairs_hook=collections.OrderedDict)
        added = 0
        for key, m in T.items():
            if key in data:
                continue
            if loc not in m:
                raise SystemExit('missing %s for %s' % (key, loc))
            data[key] = collections.OrderedDict([('message', m[loc]), ('description', '读伴书页')])
            added += 1
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write('\n')
        print('%-6s +%d  (total %d)' % (loc, added, len(data)))

if __name__ == '__main__':
    main()
