// 国内网络下 storage.googleapis.com/download.flutter.io 不可达，Gradle 解析 Flutter engine
// 构件时会无限挂起。此 init 脚本把 flutter gradle 插件注入的引擎 Maven 仓库就地改写为
// 官方中国镜像（storage.flutter-io.cn），用法：
//   ./gradlew assembleDebug -I china-mirror.init.gradle.kts
gradle.projectsLoaded {
    rootProject.allprojects {
        afterEvaluate {
            for (repo in repositories) {
                if (repo is org.gradle.api.artifacts.repositories.MavenArtifactRepository) {
                    val url = repo.url.toString()
                    if (url.startsWith("https://storage.googleapis.com")) {
                        repo.url = java.net.URI.create(url.replace("storage.googleapis.com", "storage.flutter-io.cn"))
                        logger.lifecycle("china-mirror: $url -> ${repo.url}")
                    }
                }
            }
        }
    }
}
