import { getSupportedExtensions, validateFileUpload } from '../fileValidation'

/**
 * 测试文件验证功能
 */

// 测试扩展名支持
console.log('=== 测试扩展名支持 ===')
console.log('支持图片的扩展名:', getSupportedExtensions(true).slice(0, 10)) // 显示前10个
console.log('不支持图片的扩展名:', getSupportedExtensions(false).slice(0, 10)) // 显示前10个

// 测试文件验证
const testValidation = async () => {
  console.log('\n=== 测试文件验证 ===')

  // 测试已知文本文件
  const textContent = 'This is a test text file content.'
  const textFile = new File([textContent], 'test.unknown', { type: 'text/plain' })

  const validation = await validateFileUpload(textFile, true)
  console.log('未知扩展名的文本文件验证结果:', validation)

  // 测试已知扩展名文件
  const jsFile = new File([textContent], 'test.js', { type: 'text/javascript' })
  const jsValidation = await validateFileUpload(jsFile, false)
  console.log('JavaScript文件验证结果:', jsValidation)

  // 测试二进制文件
  const binaryData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) // JPEG header
  const imageFile = new File([binaryData], 'test.unknown', { type: 'image/jpeg' })
  const imageValidation = await validateFileUpload(imageFile, true)
  console.log('未知扩展名的图片文件验证结果:', imageValidation)
}

// 运行测试（如果在浏览器环境中）
if (typeof window !== 'undefined') {
  testValidation().catch(console.error)
}
