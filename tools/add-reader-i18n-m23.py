#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""读伴书页 M2/M3（epub + PDF）新增界面文案 → 8 种语言词典（只做加法，不改动其它已有键）

用法：python3 tools/add-reader-i18n-m23.py
"""
import json, os, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOC = os.path.join(ROOT, '_locales')
LANGS = ['en', 'zh_CN', 'ja', 'ko', 'de', 'fr', 'es', 'ru']

K = collections.OrderedDict

T = K([
    ('rdrImportProgress', K([
        ('en', 'Reading the file… ({done}/{total})'),
        ('zh_CN', '正在读取文件…（{done}/{total}）'),
        ('ja', 'ファイルを読み込み中…（{done}/{total}）'),
        ('ko', '파일을 읽는 중… ({done}/{total})'),
        ('de', 'Datei wird gelesen… ({done}/{total})'),
        ('fr', 'Lecture du fichier… ({done}/{total})'),
        ('es', 'Leyendo el archivo… ({done}/{total})'),
        ('ru', 'Чтение файла… ({done}/{total})'),
    ])),
    ('rdrEpubDrm', K([
        ('en', 'This epub is DRM-protected and cannot be opened'),
        ('zh_CN', '这本 epub 带数字版权保护（DRM），无法解析'),
        ('ja', 'この epub は DRM 保護されているため開けません'),
        ('ko', '이 epub은 DRM으로 보호되어 열 수 없습니다'),
        ('de', 'Dieses epub ist DRM-geschützt und kann nicht geöffnet werden'),
        ('fr', 'Cet epub est protégé par DRM et ne peut pas être ouvert'),
        ('es', 'Este epub tiene DRM y no se puede abrir'),
        ('ru', 'Этот epub защищён DRM и не может быть открыт'),
    ])),
    ('rdrEpubInvalid', K([
        ('en', 'This epub file is damaged or incomplete'),
        ('zh_CN', 'epub 文件损坏或格式不完整'),
        ('ja', 'epub ファイルが壊れているか不完全です'),
        ('ko', 'epub 파일이 손상되었거나 불완전합니다'),
        ('de', 'Diese epub-Datei ist beschädigt oder unvollständig'),
        ('fr', 'Ce fichier epub est endommagé ou incomplet'),
        ('es', 'Este archivo epub está dañado o incompleto'),
        ('ru', 'Файл epub повреждён или неполный'),
    ])),
    ('rdrEpubNoText', K([
        ('en', 'No readable text was found in this epub'),
        ('zh_CN', '这本 epub 里没有可读的正文文字'),
        ('ja', 'この epub には読める本文がありません'),
        ('ko', '이 epub에서 읽을 수 있는 본문을 찾지 못했습니다'),
        ('de', 'In diesem epub wurde kein lesbarer Text gefunden'),
        ('fr', 'Aucun texte lisible trouvé dans cet epub'),
        ('es', 'No se encontró texto legible en este epub'),
        ('ru', 'В этом epub не найдено читаемого текста'),
    ])),
    ('rdrPdfEncrypted', K([
        ('en', 'This PDF is password-protected and cannot be opened'),
        ('zh_CN', '这份 PDF 有密码保护，无法打开'),
        ('ja', 'この PDF はパスワード保護されているため開けません'),
        ('ko', '이 PDF는 암호로 보호되어 열 수 없습니다'),
        ('de', 'Diese PDF ist passwortgeschützt und kann nicht geöffnet werden'),
        ('fr', 'Ce PDF est protégé par mot de passe et ne peut pas être ouvert'),
        ('es', 'Este PDF está protegido con contraseña y no se puede abrir'),
        ('ru', 'Этот PDF защищён паролем и не может быть открыт'),
    ])),
    ('rdrPdfInvalid', K([
        ('en', 'This PDF file is damaged and cannot be read'),
        ('zh_CN', 'PDF 文件损坏，无法读取'),
        ('ja', 'PDF ファイルが壊れているため読み込めません'),
        ('ko', 'PDF 파일이 손상되어 읽을 수 없습니다'),
        ('de', 'Diese PDF-Datei ist beschädigt und kann nicht gelesen werden'),
        ('fr', 'Ce fichier PDF est endommagé et illisible'),
        ('es', 'Este archivo PDF está dañado y no se puede leer'),
        ('ru', 'Файл PDF повреждён и не читается'),
    ])),
    ('rdrPdfNoText', K([
        ('en', 'This is a scanned PDF (images only, no text layer), so it cannot be turned into a book page'),
        ('zh_CN', '这是扫描版 PDF（只有图片、没有文字层），暂时无法转成书页'),
        ('ja', 'スキャン版 PDF（画像のみ・テキスト層なし）のため、書ページに変換できません'),
        ('ko', '스캔본 PDF(이미지만 있고 텍스트 레이어 없음)라서 책 페이지로 변환할 수 없습니다'),
        ('de', 'Das ist ein gescanntes PDF (nur Bilder, keine Textebene) — daraus lässt sich keine Buchseite machen'),
        ('fr', 'Il s’agit d’un PDF scanné (images seules, sans couche de texte) : impossible d’en faire une page de livre'),
        ('es', 'Es un PDF escaneado (solo imágenes, sin capa de texto): no se puede convertir en página de libro'),
        ('ru', 'Это сканированный PDF (только изображения, без текстового слоя) — страницу книги из него не сделать'),
    ])),
    ('rdrPdfTooLarge', K([
        ('en', 'This PDF is too large (over 300 MB)'),
        ('zh_CN', 'PDF 太大（超过 300MB），暂不支持'),
        ('ja', 'PDF が大きすぎます（300MB 超）'),
        ('ko', 'PDF가 너무 큽니다(300MB 초과)'),
        ('de', 'Diese PDF ist zu groß (über 300 MB)'),
        ('fr', 'Ce PDF est trop volumineux (plus de 300 Mo)'),
        ('es', 'Este PDF es demasiado grande (más de 300 MB)'),
        ('ru', 'Этот PDF слишком большой (более 300 МБ)'),
    ])),
    ('rdrPdfLibFailed', K([
        ('en', 'The PDF engine failed to load — reload the extension and try again'),
        ('zh_CN', 'PDF 引擎加载失败，请重新加载扩展后再试'),
        ('ja', 'PDF エンジンの読み込みに失敗しました。拡張機能を再読み込みしてください'),
        ('ko', 'PDF 엔진을 불러오지 못했습니다. 확장 프로그램을 다시 로드하세요'),
        ('de', 'Die PDF-Engine konnte nicht geladen werden — Erweiterung neu laden und erneut versuchen'),
        ('fr', 'Le moteur PDF n’a pas pu être chargé — rechargez l’extension et réessayez'),
        ('es', 'No se pudo cargar el motor PDF: recarga la extensión e inténtalo de nuevo'),
        ('ru', 'Не удалось загрузить движок PDF — перезагрузите расширение и повторите'),
    ])),
    # ---- 下面两个是已有键，M2/M3 落地后文案需要同步（从「即将支持」改为「已支持」） ----
    ('rdrDropHint', K([
        ('en', 'Drop a .txt / .md / .epub / .pdf file here'),
        ('zh_CN', '把 .txt / .md / .epub / .pdf 文件拖到这里'),
        ('ja', 'ここに .txt / .md / .epub / .pdf をドロップ'),
        ('ko', '여기에 .txt / .md / .epub / .pdf 파일을 놓으세요'),
        ('de', '.txt-/.md-/.epub-/.pdf-Datei hier ablegen'),
        ('fr', 'Déposez un fichier .txt / .md / .epub / .pdf ici'),
        ('es', 'Suelta aquí un archivo .txt / .md / .epub / .pdf'),
        ('ru', 'Перетащите сюда файл .txt / .md / .epub / .pdf'),
    ])),
    ('rdrLandingDesc', K([
        ('en', 'Drop a txt, Markdown, epub or PDF file and it becomes a beautifully typeset book — read aloud, bilingual view and export in one place. Scanned PDFs and DRM ebooks are not supported.'),
        ('zh_CN', '把 txt / Markdown / epub / PDF 拖进来，就是一页排版精美的书——朗读、双语对照、导出一步到位。扫描版 PDF 与带 DRM 的电子书暂不支持。'),
        ('ja', 'txt / Markdown / epub / PDF をドロップするだけで、美しく組版された一冊に。朗読・対訳・書き出しまでこれ一つで。スキャン版 PDF と DRM 付き電子書は未対応です。'),
        ('ko', 'txt, Markdown, epub, PDF 파일을 떨어뜨리면 한 권의 책이 됩니다. 낭독, 대역, 내보내기까지 한곳에서. 스캔본 PDF와 DRM 전자책은 지원하지 않습니다.'),
        ('de', 'Ziehen Sie eine txt-, Markdown-, epub- oder PDF-Datei hinein — daraus wird ein schön gesetztes Buch mit Vorlesen, zweisprachiger Ansicht und Export. Gescannte PDFs und DRM-E-Books werden nicht unterstützt.'),
        ('fr', 'Déposez un fichier txt, Markdown, epub ou PDF : il devient un livre élégamment composé, avec lecture à voix haute, vue bilingue et export. Les PDF scannés et les ebooks DRM ne sont pas pris en charge.'),
        ('es', 'Suelta un archivo txt, Markdown, epub o PDF y se convertirá en un libro bien maquetado: lectura en voz alta, vista bilingüe y exportación. Los PDF escaneados y los ebooks con DRM no son compatibles.'),
        ('ru', 'Перетащите файл txt, Markdown, epub или PDF — и он превратится в красиво свёрстанную книгу: чтение вслух, двуязычный режим и экспорт. Сканированные PDF и книги с DRM не поддерживаются.'),
    ])),
])


def main():
    added = updated = 0
    for lang in LANGS:
        path = os.path.join(LOC, lang, 'messages.json')
        with open(path, encoding='utf-8') as f:
            data = json.load(f, object_pairs_hook=collections.OrderedDict)
        for key, trans in T.items():
            if key in data:
                if data[key].get('message') != trans[lang]:
                    data[key]['message'] = trans[lang]
                    updated += 1
            else:
                data[key] = collections.OrderedDict([('message', trans[lang])])
                added += 1
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write('\n')
    print('新增 %d 条 / 更新 %d 条（8 种语言）' % (added, updated))


if __name__ == '__main__':
    main()
