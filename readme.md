# Yaxy

Yaxy -- это proxy-сервер для веб-разработчика, подменяющий запрашиваемые ресурсы, следуя простым правилам.

## Формат правил

Правила реврайтинга имеют очень простой формат

    pattern => replacement

Каждое правило располагается в отдельной строке. Пустые строки и строки, начинающиеся с символа `#`, игнорируются.

### Простая замена урлов

Правило

    host.com/some/path => another-host.com/another/path

значит буквально следующее: в урлах, начинающихся на `http://host.com/some/path`, заменить это начало на `http://another-host.com/another/path`. Т.е. `host.com/some/path` превратится в `another-host.com/another/path`, `host.com/some/path/foo/bar` превратится в `another-host.com/another/path/foo/bar`, а `host.com/some/` останется без изменений.

### Взятие файлов с файловой системы

Чтобы заматчить урл на файловую систему, используется протокол file://.

    # windows
    host.com/some/path => file://c:/www/host.com
    # linux
    host.com/some/path => file:///home/www/host.com

index-файл для директорий -- index.html. Для приведённого примера по урлу `host.com/some/path` прилетит файл `c:/www/host.com/index.html`, по урлу `host.com/some/path/empty.gif` прилетит файл `c:/www/host.com/empty.gif`.

### Использование data:uri

Если замена настолько простая, что даже файл создавать неохота, можно использовать data:uri

    host.com/some/path => data:text/html;<script type="text/javascript">alert('Привет!');</script>

В этом случае на все урлы, начинающиеся на `host.com/some/path` будет ответ `<script type="text/javascript">alert('Привет!');</script>`.

    host.com/some/path/png => data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQAQMAAAAlPW0iAAAABlBMVEUAAAD///+l2Z/dAAAAM0lEQVR4nGP4/5/h/1+G/58ZDrAz3D/McH8yw83NDDeNGe4Ug9C9zwz3gVLMDA/A6P9/AFGGFyjOXZtQAAAAAElFTkSuQmCC

На урлы, начинающиеся на `host.com/some/path/png` отвечаем картинкой.


## Как начать использовать

Если у вас до сих пор не установлен NodeJS, [устанавливайте](http://nodejs.org/).

Теперь клонируем или скачиваем исходники Yaxy. Где-нибудь, например, в папке со скачанными исходниками, создайте файл config.txt, в котором и будут лежать правила реврайта. Осталось запустить Yaxy, находясь в папке с config.txt. Если это папка с исходниками, то запустить можно `node .`, или `node index`, или `node index.js`. Если config.txt лежит отдельно от исходников, то `node path/to/yaxy`.

Теперь нужно настроить все свои браузеры, чтобы они ходили в интернет через yaxy. Для этого открываем в браузере настройки proxy-сервера и выставляем там хост 127.0.0.1 (или другой, если yaxy на другой машине) и порт 8558 (по умолчанию).

После правки содержимого config.txt перезапускать Yaxy не надо, изменения подхватятся автоматически.
