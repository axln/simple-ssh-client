# Анализ задачи

В качестве тестового здания в конкурсе на вакансию разработчика Node.js было представлено следующее задание.

## Задание
Необходимо создать консольную утилиту, которая будет представлять собой полноценный ssh-клиент, то есть утилита должна транслировать команды вводимые пользователем на удаленную систему и получать результат их выполнения.

Требования:

 1. Дополнительно нужно реализовать собственную команду get <filename> при вводе которой, утилита будет скачивать с удаленного сервера указанный файл.
 2. Весь код приложения должен соответствовать es6+.
 3. Использовать сторонние модули по согласованию.

Пример работы программы:

```
MacBook-Pro-Nikolaj:ssh-test dos$ node ssh.js root:pxtm0222@10.8.0.22
[18:29:12] Connecting to 10.8.0.22...
[18:29:15] Connection successful.
Welcome to Ubuntu 14.04.4 LTS (GNU/Linux 3.16.0-67-generic x86_64)
* Documentation:  https://help.ubuntu.com/
 System information as of Mon Nov 14 14:15:46 MSK 2016
 System load:  0.08               Processes:           165
 Usage of /:   82.6% of 94.11GB   Users logged in:     0
 Memory usage: 59%                IP address for eth0: 10.8.0.22
 Swap usage:   18%
 Graph this data and manage this system at:
   https://landscape.canonical.com/
Last login: Sun Nov 13 23:03:01 2016 from 10.8.0.18
root@mainsrv:~# cd /etc
root@mainsrv:/etc# ls | grep deb
debconf.conf
debian_version
root@mainsrv:/etc# get debian_version
[18:29:44] Downloading 10.8.0.22:/etc/debian_version from to 127.0.0.1:/Users/dos/www/ssh-test/
[18:29:46] File is downloaded successfully
root@mainsrv:/etc# exit
MacBook-Pro-Nikolaj:ssh-test dos$ ls
debian_version    node_modules    npm-debug.log    package.json    ssh.js
MacBook-Pro-Nikolaj:ssh-test dos$ cat debian_version
jessie/sid
MacBook-Pro-Nikolaj:ssh-test dos$
```
Опциональные требования:

 1. Реализовать отправку файлов на удаленный сервер (команда put /path/to/localfile)
 2. Реализовать возможность автодополнения по нажатию Tab, как в нативном SSH клиенте
 3. Реализовать корректную обработку комбинации клавиш Ctrl+C (Cmd+C) для выхода из программы внутри ssh-сессии, например когда запущена команда top
 4. SSH клиент должен уметь пробрасывать порты на локальную машину (то есть создавать полноценные SSH-тунели [-L [bind_address:]port:host:port] ).
 5. SSH клиент должен уметь пробрасывать порты на удаленную машину [-R [bind_address:]port:host:port]
 6. Покрыть написанный код тестами.
 
 ## Анализ

До начала работы над задачей было согласовано использование следующих npm-модулей:
 1. [https://github.com/mscdex/ssh2](https://github.com/mscdex/ssh2)
 2. [https://github.com/yargs/yargs](https://github.com/yargs/yargs)
 3. [https://github.com/Marak/colors.js](https://github.com/Marak/colors.js)
 
Задача на первый вгзляд кажется простой, так как уже имеется хорошая реализация протокола SSH и, по сути, необходимо только разработать консольный интерфейс к этой библиотеке. Но при детальном изучении выяснилось, что требования достаточно коварны, в том смысле, что они конфликтуют между собой так, что качественная реализация одного пункта препятствует качественной реализации другого.

К примеру, задача требует реализовать полноценный SSH-клиент для работы в интерактивном режиме, но при этом необходимо добавить собственные команды. Но для обработки собственных команд нам необходимо полностью буферизировать вводимую пользователем команду на клиенте (как это делает утилита telnet) до отправки её на сервер по нажатию Enter, чтобы иметь возможность отделить внутренние команды get/put от команд удалённой системы.

SSH-клиент работает по-другому, он не буферизирует ввод пользователя на клиенте, а перенаправляет ввод пользователя на сервер (файл стандартного ввода работает в raw-режиме, при котором всё нажатия клавиш пишутся в файл мгновенно), где его обрабатывает либо командный интерпретатор (например, bash), либо программа с текстовым интерфейсом (например, Midnight Commander). По сути задача полноценного SSH-клиента (при работе в интерактивном режиме) состоит только в передаче ввода/вывода по шифрованному каналу. SSH-клиент не воспринимает ввод пользователя как команды, но как поток байтов, и не принимает никакого участия в обработке команд пользователя. Именно поэтому все функции по работе с файлами были вынесены в отдельную утилиту scp, а SSH-клиент дополнительно имеет встроенные функции по тунелированию TCP-соединений, так как для протокола нет большого различия что именно транслировать: ввод/вывод терминала или TCP-сессию.

Кроме того, мы не можем просто ограничиться SSH-клиентом, который будет работать в пакетном режиме, так как задача требует наличия интерактивных возможностей командного интерпретатора: автодополнение по нажатию Tab и работу с утилитами вроде top, которые непрерывно обновляют свой вывод.

К сожалению, исходя из перечисленных выше соображений, для удовлетворения основных и дополнительных требований, задачу нельзя было решить простым и элегантным методом в стиле Unix-way путем перенаправления ввода/вывода в потоки SSH-соединения, а пришлось идти методом "костылей", обрабатывать множество частных ситуаций и делать много допущений по поведению удалённой системы, что может привести в целом к ненадёжной работе программы.

Список проблем, которые пришлось решить:

1. Подавление эхо-вывода. Т. к. мы редактируем команду на клиенте и на момент отправки команды пользователь уже видит её на экране, но первый вывод который мы получим от SSH-сервера - это эхо-вывод отправленной команды. Было принято решение сохранить отправленную команду в буфере и игнорировать дубликат вывода от сервера. Не обошлось без сюрпризов, к примеру, если мы отправляем на сервер (для тестирования использовался Ubuntu c OpenSSH и bash) команду "pwd\n", причем символ конца строки отправлять надо обязательно, иначе интерпретатор на сервере не начнёт обработку команды, то в качестве эхо мы получаем уже "pwd\r\n", т. е. не точный дубликат ввода. Проблема была решена путем игнорировать символа \r внутри эхо-буфера.

2. Нет возможности обработать нажатие клавиши Tab при работе с потоком стандартного ввода (всегда вводится как символ), когда файл работает в режиме редактора строки (Node.js пишет в файл только после нажатия Enter). Для решения проблемы нужно переводить файл в raw-режим, но тогда система не предоставляет функции редактора строки, а только посылает события keypress. Для решения проблемы использован встроенный Node.js-модуль редактора строки readline, но модуль имеет ряд побочных эффектов. К примеру, при удалении символов из вводимой команды, readline затирает самое начало строки, на котором обычно выводится приглашение командной строки удалённой системы, и вся команда выводится с начала строки. Выходом из этой ситуации может быть разработка собственного модуля редактора строки, от чего было решено отказаться.

3. Сами по себе задачи по реализации команд get/put простые, т. к. модуль SSH2 поддерживает работу с файлами через интерфейс SFTP, но судя по примеру работы программы, нам необходимо позволять пользователю вводить имена файлов без абсолютного пути, значит мы обязаны знать в какой директории сейчас находится пользователь. Но протокол SSH не предоставляет нам такой возможности, ведь он предоставляет только канал связи, а текущую директорию знает командный интерпретатор удалённой системы. Мы можем запустить команду pwd отдельным запросом в пакетном режиме, но для её выполнения будет создана новая сессия со своей текущей директорией. Поэтому остается только выполнять pwd в текущей интерактивной сессии и перехватывать результат её выполнения. Здесь приходится делать допущение, что удалённая система является именно Unix/Linux системой и поддерживает команду pwd. Кроме того, в качестве вывода вместе с текущим каталогом мы получаем также эхо-вывод самой команды и строку с приглашением командной строки, поэтому нам приходится делать допущение также по конкретному формату вывода команды.

4. Поддержку автоматического дополнения по нажатию Tab удалось реализовать путем отправки частично введенной команды с завершающим символом табуляции \t, а также перехвата ответа от сервера с подавлением эхо-вывода. Но теперь на удалённом сервере в командной строке осталась введённая, но невыполненная команда. Перед отправкой команды с клиента нам необходимо очистить командную строку, причем мы не можем сделать это путем выполнения этой команды, т. к. её выполнение еще не подтверждено пользователем. Данная проблема была решена путем скрытой от пользователя отправки на сервер символа 0x15 (Ctrl+U - очистить текущую строку) и подавления эхо-вывода. Здесь также сделано допущение, что командный интерпретатор должен корректно обрабатывать этот символ.

## Заключение

Во время реализации остальных функций клиента серьезных проблем не возникло и в итоге все функции были реализованы. Кроме того, дополнительно были реализованы возможность указать нестандартный порт с помощью параметра `-p`, а также возможность аутентификации через SSH-агент, если пароль не указан в параметрах командной строки и если на сервере добавлен открытый ключ текущего пользователя в список доверенных.

К сожалению, разработанную утилиту вряд ли можно будет использовать на практике, т. к. множество допущений о работе удалённой системы ограничивают область её применения.

Код задачи может скорее служить примером какие обходные пути приходится использовать, если нет возможности пересмотреть требования к поставленной задаче.

##  Known Issues and Limitations

 1. Во время правки текущей команды затирается приглашение удалённой системы (особенность модуля readline). Модуль readline позволяет указать своё приглашение, но к сожалению, у нас нет надёжного метода получения строки приглашения с удалённой системы.

 2. Для упрощения реализации, не поддерживаются множественные параметры для проброса портов, как это делает SSH-клиент. В текущей реализации пользователь может указать только один набор локального и один набор удалённого проброса портов.
 
 3. При завершении терминальной сессии приложение завершает свою работу, и не ждёт закрытия проброшенных соединений, как это делает SSH-клиент. Это сделано также для упрощения реализации.
