import java.net.URI
import org.gradle.api.artifacts.repositories.MavenArtifactRepository

allprojects {
    repositories {
        maven("https://maven.aliyun.com/repository/google")
        maven("https://maven.aliyun.com/repository/public")
        google()
        mavenCentral()
    }
}

// 国内网络下 storage.googleapis.com/download.flutter.io 不可达，Gradle 解析 Flutter engine
// 构件（io.flutter embedding jar）时会无限挂起。Flutter 插件在应用时注入该仓库
// （FlutterPlugin.kt 读 FLUTTER_STORAGE_BASE_URL，默认 googleapis），这里在插件应用回调里
// 把该仓库就地改写为官方中国镜像。需要直连 googleapis 时设置 FLUTTER_STORAGE_BASE_URL 覆盖。
allprojects {
    afterEvaluate {
        for (repo in repositories) {
            val maven = repo as? MavenArtifactRepository ?: continue
            val url = maven.url.toString()
            if (url.startsWith("https://storage.googleapis.com")) {
                maven.url = URI(url.replace("storage.googleapis.com", "storage.flutter-io.cn"))
                logger.lifecycle("flutter-engine-mirror: $url -> ${maven.url}")
            }
        }
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
